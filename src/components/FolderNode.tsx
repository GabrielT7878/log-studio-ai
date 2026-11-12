import { ask } from "@tauri-apps/plugin-dialog";
import { FullscreenButton } from "./FullscreenButton";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  File,
  FilePlus,
  FolderPlus,
  FileText,
  Folder,
  Image as ImageIcon,
  List,
  PanelLeft,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../hooks/usePresence";
import { api, type FsEntry, type FsSearchHit } from "../lib/api";
import {
  FOLDER_FONT_MAX,
  FOLDER_FONT_MIN,
  FOLDER_MIN_H,
  FOLDER_MIN_W,
  noteFontFamily,
  type FolderNodeData,
  type FolderSort,
  type NodePatch,
  type TabSize,
} from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";
import { renderMarkdown } from "../lib/markdown";
import { scrubNumber } from "../lib/scrub";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FontPicker, NotePopover } from "./NotePopover";
import { SmoothCaret } from "./SmoothCaret";

interface Props {
  node: FolderNodeData;
  space: string;
  projectId: string;
  projectName: string;
  zoom: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: NodePatch) => void;
  /** Esta janela está em tela cheia. */
  fullscreen?: boolean;
  onToggleFullscreen?: (id: string) => void;
  onError: (message: string) => void;
}

/** Evento global: arquivos do projeto mudaram (todas as janelas Pasta dele recarregam). */
const FS_CHANGED = "logstudio:fs-changed";
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;
const MARKDOWN_EXT = /\.(md|markdown|mdx)$/i;
const SORTS: { id: FolderSort; label: string }[] = [
  { id: "name", label: "Nome" },
  { id: "modified", label: "Data de modificação" },
  { id: "size", label: "Tamanho" },
];

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
const baseName = (path: string) => path.split("/").pop() ?? path;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Arquivo aberto no editor. */
type Opened =
  | { kind: "loading" }
  | { kind: "text"; content: string; original: string }
  | { kind: "image"; url: string }
  | { kind: "binary" }
  | { kind: "tooLarge"; size: number }
  | { kind: "error"; message: string };

/** Janela "Pasta": arquivos do projeto à esquerda, editor à direita. */
export function FolderNode({ node, space, projectId, projectName, zoom, selected, onSelect, onChange, onError, fullscreen = false, onToggleFullscreen }: Props) {
  // ---------------- Lista da pasta ----------------
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    api
      .fsList(space, projectId, node.dir)
      .then((list) => alive && setEntries(list))
      .catch((e) => {
        if (!alive) return;
        setEntries([]);
        onError(String(e));
        if (node.dir) onChange(node.id, { dir: "" }); // pasta sumiu: volta para a raiz
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega ao mudar de pasta
  }, [space, projectId, node.dir, reload]);

  // Outra janela "Pasta" moveu/criou arquivos neste projeto: recarrega a lista.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<{ space: string; projectId: string }>).detail;
      if (d.space === space && d.projectId === projectId) setReload((r) => r + 1);
    };
    window.addEventListener(FS_CHANGED, onChanged);
    return () => window.removeEventListener(FS_CHANGED, onChanged);
  }, [space, projectId]);

  const sorted = useMemo(() => {
    if (!entries) return null;
    const cmp = (a: FsEntry, b: FsEntry) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (node.sort === "modified") return b.modified - a.modified;
      if (node.sort === "size") return b.size - a.size;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    };
    return [...entries].sort(cmp);
  }, [entries, node.sort]);

  // Histórico de pastas (‹ ›): só nesta sessão.
  const [history, setHistory] = useState({ stack: [node.dir], index: 0 });
  const go = (dir: string) => {
    if (dir === node.dir) return;
    setHistory((h) => ({ stack: [...h.stack.slice(0, h.index + 1), dir], index: h.index + 1 }));
    onChange(node.id, { dir });
  };
  const step = (delta: number) => {
    const index = history.index + delta;
    if (index < 0 || index >= history.stack.length) return;
    setHistory({ ...history, index });
    onChange(node.id, { dir: history.stack[index] });
  };

  // ---------------- Busca ----------------
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FsSearchHit[] | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      api
        .fsSearch(space, projectId, q)
        .then((hits) => alive && setResults(hits))
        .catch((e) => alive && onError(String(e)));
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, space, projectId]);

  // ---------------- Arquivo aberto ----------------
  const [opened, setOpened] = useState<Opened | null>(null);
  const dirty = opened?.kind === "text" && opened.content !== opened.original;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Caminho novo do arquivo aberto depois de mover: mantém o conteúdo (e as alterações).
  const movedTo = useRef<string | null>(null);

  useEffect(() => {
    const rel = node.openFile;
    if (rel && rel === movedTo.current) {
      movedTo.current = null;
      return;
    }
    if (!rel) {
      setOpened(null);
      return;
    }
    let alive = true;
    let url: string | null = null;
    setOpened({ kind: "loading" });
    if (IMAGE_EXT.test(rel)) {
      api
        .fsReadBytes(space, projectId, rel)
        .then((buf) => {
          const type = rel.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "";
          url = URL.createObjectURL(new Blob([buf], type ? { type } : undefined));
          if (alive) setOpened({ kind: "image", url });
        })
        .catch((e) => alive && setOpened({ kind: "error", message: String(e) }));
    } else {
      api
        .fsReadText(space, projectId, rel)
        .then((f) => {
          if (!alive) return;
          if (f.kind === "text") setOpened({ kind: "text", content: f.content, original: f.content });
          else setOpened(f);
        })
        .catch((e) => alive && setOpened({ kind: "error", message: String(e) }));
    }
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [space, projectId, node.openFile]);

  /** Confirma descartar alterações não salvas (se houver). */
  const confirmDiscard = async () => {
    if (!dirtyRef.current || !node.openFile) return true;
    return ask(`"${baseName(node.openFile)}" tem alterações não salvas. Descartar?`, {
      title: "Alterações não salvas",
      kind: "warning",
      okLabel: "Descartar",
      cancelLabel: "Cancelar",
    });
  };

  const openFile = async (rel: string) => {
    if (rel === node.openFile) return;
    if (await confirmDiscard()) onChange(node.id, { openFile: rel });
  };

  const closeFile = async () => {
    if (await confirmDiscard()) onChange(node.id, { openFile: null });
  };

  const save = () => {
    if (!node.openFile || opened?.kind !== "text" || !dirty) return;
    const { content } = opened;
    const rel = node.openFile;
    api
      .fsWriteText(space, projectId, rel, content)
      .then(() => {
        setOpened((o) => (o?.kind === "text" ? { ...o, original: content } : o));
        if (parentOf(rel) === node.dir) setReload((r) => r + 1); // atualiza tamanho/data na lista
      })
      .catch((e) => onError(String(e)));
  };

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const onEditorKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    if (e.key === "Escape") {
      e.currentTarget.blur();
      return;
    }
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
      // Tab insere espaços (Tamanho da Tabulação).
      e.preventDefault();
      const ta = e.currentTarget;
      const spaces = " ".repeat(node.tabSize);
      const { selectionStart: s, selectionEnd: end, value } = ta;
      const next = value.slice(0, s) + spaces + value.slice(end);
      setOpened((o) => (o?.kind === "text" ? { ...o, content: next } : o));
      requestAnimationFrame(() => ta.setSelectionRange(s + spaces.length, s + spaces.length));
    }
  };

  // ---------------- Arrastar arquivos/pastas para dentro de outra pasta ----------------
  const [dragGhost, setDragGhost] = useState<{ name: string; isDir: boolean; x: number; y: number } | null>(null);
  const justDragged = useRef(false);

  /** Destino sob o cursor: pasta da lista (data-drop-dir) ou a lista de uma janela Pasta. */
  const dropTargetAt = (x: number, y: number, from: string, isDir: boolean) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-dir]");
    if (!el || el.dataset.dropSpace !== space || el.dataset.dropProject !== projectId) return null;
    const dir = el.dataset.dropDir ?? "";
    if (dir === from || (isDir && dir.startsWith(`${from}/`))) return null; // nela mesma
    return { el, dir };
  };

  const startEntryDrag = (e: React.PointerEvent, from: string, name: string, isDir: boolean) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    let hover: HTMLElement | null = null;
    const setHover = (el: HTMLElement | null) => {
      if (hover === el) return;
      hover?.classList.remove("drop-target");
      el?.classList.add("drop-target");
      hover = el;
    };

    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        dragging = true;
        document.documentElement.classList.add("fb-dragging");
      }
      setDragGhost({ name, isDir, x: ev.clientX, y: ev.clientY });
      setHover(dropTargetAt(ev.clientX, ev.clientY, from, isDir)?.el ?? null);
    };
    const end = (ev: PointerEvent | null) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      setHover(null);
      setDragGhost(null);
      document.documentElement.classList.remove("fb-dragging");
      if (!dragging) return;
      justDragged.current = true; // o clique que vem depois do soltar não abre o item
      window.setTimeout(() => (justDragged.current = false), 0);
      const target = ev && dropTargetAt(ev.clientX, ev.clientY, from, isDir);
      if (target) moveEntry(from, target.dir);
    };
    const up = (ev: PointerEvent) => end(ev);
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && end(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
  };

  const moveEntry = (from: string, toDir: string) => {
    if (parentOf(from) === toDir) return; // já está lá
    api
      .fsMove(space, projectId, from, toDir)
      .then((to) => {
        // O arquivo aberto (ou a pasta dele) foi movido: segue o caminho novo sem recarregar.
        const open = node.openFile;
        if (open && (open === from || open.startsWith(`${from}/`))) {
          const next = to + open.slice(from.length);
          movedTo.current = next;
          onChange(node.id, { openFile: next });
        }
        window.dispatchEvent(new CustomEvent(FS_CHANGED, { detail: { space, projectId } }));
      })
      .catch((err) => onError(String(err)));
  };

  // ---------------- Criar arquivo / pasta ----------------
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const [createMenu, setCreateMenu] = useState<{ x: number; y: number } | null>(null);
  const createPresence = usePresence(!!createMenu, 110);

  const startCreate = (kind: "file" | "dir") => {
    setQuery(""); // a linha de nome aparece na pasta atual
    setCreating(kind);
  };

  const finishCreate = (name: string | null) => {
    const kind = creating;
    setCreating(null);
    if (!kind || !name?.trim()) return;
    api
      .fsCreate(space, projectId, node.dir, name.trim(), kind === "dir")
      .then((rel) => {
        window.dispatchEvent(new CustomEvent(FS_CHANGED, { detail: { space, projectId } }));
        if (kind === "file") openFile(rel);
      })
      .catch((e) => onError(String(e)));
  };

  const createItems: ContextMenuItem[] = [
    { label: "Novo arquivo", icon: FilePlus, onSelect: () => startCreate("file") },
    { label: "Nova pasta", icon: FolderPlus, onSelect: () => startCreate("dir") },
  ];

  // ---------------- Painéis (configurações, ordenar, fonte) ----------------
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [fontAt, setFontAt] = useState<{ x: number; y: number } | null>(null);
  const fontPresence = usePresence(!!fontAt, 110);
  const settingsRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  // Clicar fora fecha os painéis internos (o seletor de fonte conta como "dentro").
  useEffect(() => {
    if (!settingsOpen && !sortOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".note-popover")) return;
      if (settingsOpen && !settingsRef.current?.contains(t)) setSettingsOpen(false);
      if (sortOpen && !sortRef.current?.contains(t)) setSortOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [settingsOpen, sortOpen]);

  useEffect(() => {
    if (!settingsOpen) setFontAt(null);
  }, [settingsOpen]);

  // ---------------- Mover / redimensionar ----------------
  /** Arrastar pelo espaço vazio dos cabeçalhos move a janela. */
  const onHeaderDown = (e: React.PointerEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && !t.classList.contains("fb-drag")) return;
    onSelect(node.id);
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { w, h } = node;
    dragPointer(e, (dx, dy) =>
      onChange(node.id, { w: Math.max(FOLDER_MIN_W, w + dx / zoom), h: Math.max(FOLDER_MIN_H, h + dy / zoom) }),
    );
  };

  // ---------------- Render ----------------
  const dirName = node.dir ? baseName(node.dir) : projectName;
  const fontLabel = node.font || "Cascadia Mono";
  const fontCss = noteFontFamily(node.font);
  const isMarkdown = !!node.openFile && MARKDOWN_EXT.test(node.openFile);
  const html = useMemo(
    () => (opened?.kind === "text" && isMarkdown && node.markdown ? renderMarkdown(opened.content) : ""),
    [opened, isMarkdown, node.markdown],
  );

  const entryIcon = (name: string, isDir: boolean) =>
    isDir ? (
      <Folder size={15} className="fb-icon-dir" />
    ) : IMAGE_EXT.test(name) ? (
      <ImageIcon size={15} />
    ) : /\.(md|txt|markdown)$/i.test(name) ? (
      <FileText size={15} />
    ) : (
      <File size={15} />
    );

  return (
    <div
      className={`canvas-node folder-node${selected ? " selected" : ""}${fullscreen ? " fullscreen" : ""}`}
      data-node-id={node.id}
      style={
        {
          "--nx": node.x,
          "--ny": node.y,
          "--nw": node.w,
          "--nh": node.h,
          zIndex: selected ? 2 : 1,
        } as React.CSSProperties
      }
      onPointerDown={() => onSelect(node.id)}
    >
      <div className="fb-inner">
        {/* ---------- Lista de arquivos ---------- */}
        {node.sidebar && (
          <div className="fb-side">
            <div className="fb-header" onPointerDown={onHeaderDown}>
              <button className="fb-icon-btn" title="Voltar" disabled={history.index === 0} onClick={() => step(-1)}>
                <ChevronLeft size={16} />
              </button>
              <span className="fb-sep" />
              <button
                className="fb-icon-btn"
                title="Avançar"
                disabled={history.index >= history.stack.length - 1}
                onClick={() => step(1)}
              >
                <ChevronRight size={16} />
              </button>
              <span className="fb-title fb-drag" title={node.dir ? `${projectName}/${node.dir}` : projectName}>
                {dirName}
              </span>
              <button
                className="fb-icon-btn"
                title="Novo arquivo ou pasta"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setCreateMenu({ x: r.left, y: r.bottom + 6 });
                }}
              >
                <Plus size={16} />
              </button>
              <div className="fb-menu-anchor" ref={sortRef}>
                <button className="fb-icon-btn fb-sort-btn" title="Ordenar" onClick={() => setSortOpen((o) => !o)}>
                  <List size={16} />
                  <ChevronsUpDown size={11} />
                </button>
                {sortOpen && (
                  <div className="fb-popover fb-sort-menu">
                    {SORTS.map((s) => (
                      <button
                        key={s.id}
                        className="fb-menu-item"
                        onClick={() => {
                          onChange(node.id, { sort: s.id });
                          setSortOpen(false);
                        }}
                      >
                        <span>{s.label}</span>
                        {node.sort === s.id && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div
              className="fb-list fb-scroll"
              data-drop-dir={node.dir}
              data-drop-space={space}
              data-drop-project={projectId}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCreateMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              {creating && (
                <div className="fb-row fb-new">
                  {creating === "dir" ? <Folder size={15} className="fb-icon-dir" /> : <File size={15} />}
                  <NameInput
                    placeholder={creating === "dir" ? "Nome da pasta" : "Nome do arquivo"}
                    onDone={finishCreate}
                  />
                </div>
              )}
              {results ? (
                results.length === 0 ? (
                  <div className="fb-empty">Nada encontrado para “{query.trim()}”.</div>
                ) : (
                  results.map((hit) => (
                    <button
                      key={hit.path}
                      className={`fb-row${hit.path === node.openFile ? " active" : ""}`}
                      title={hit.path}
                      onClick={() => {
                        if (hit.isDir) {
                          go(hit.path);
                          setQuery("");
                        } else {
                          openFile(hit.path);
                        }
                      }}
                    >
                      {entryIcon(hit.path, hit.isDir)}
                      <span className="fb-name">{baseName(hit.path)}</span>
                      <span className="fb-meta">{parentOf(hit.path) || "/"}</span>
                    </button>
                  ))
                )
              ) : sorted === null ? null : sorted.length === 0 ? (
                <div className="fb-empty">Esta pasta está vazia.</div>
              ) : (
                <>
                  {node.dir && (
                    <button
                      className="fb-row"
                      title="Pasta acima"
                      data-drop-dir={parentOf(node.dir)}
                      data-drop-space={space}
                      data-drop-project={projectId}
                      onClick={() => go(parentOf(node.dir))}
                    >
                      <Folder size={15} className="fb-icon-dir" />
                      <span className="fb-name">..</span>
                    </button>
                  )}
                  {sorted.map((e) => {
                    const rel = join(node.dir, e.name);
                    return (
                      <button
                        key={e.name}
                        className={`fb-row${rel === node.openFile ? " active" : ""}`}
                        title={e.name}
                        {...(e.isDir
                          ? { "data-drop-dir": rel, "data-drop-space": space, "data-drop-project": projectId }
                          : {})}
                        onPointerDown={(ev) => startEntryDrag(ev, rel, e.name, e.isDir)}
                        onClick={() => {
                          if (justDragged.current) return;
                          if (e.isDir) go(rel);
                          else openFile(rel);
                        }}
                      >
                        {entryIcon(e.name, e.isDir)}
                        <span className="fb-name">{e.name}</span>
                        {!e.isDir && <span className="fb-meta">{formatSize(e.size)}</span>}
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            <div className="fb-footer">
              <label className="fb-search">
                <Search size={13} />
                <input
                  placeholder="Buscar"
                  value={query}
                  spellCheck={false}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                />
                {query && (
                  <button className="fb-clear" title="Limpar" onClick={() => setQuery("")}>
                    <X size={12} />
                  </button>
                )}
              </label>
              <button
                className="fb-icon-btn active"
                title="Esconder lista de arquivos"
                onClick={() => onChange(node.id, { sidebar: false })}
              >
                <PanelLeft size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ---------- Editor ---------- */}
        <div className="fb-main">
          <div className="fb-header" onPointerDown={onHeaderDown}>
            {!node.sidebar && (
              <button
                className="fb-icon-btn"
                title="Mostrar lista de arquivos"
                onClick={() => onChange(node.id, { sidebar: true })}
              >
                <PanelLeft size={16} />
              </button>
            )}
            <span className="fb-file fb-drag" title={node.openFile ?? ""}>
              {node.openFile ? `${baseName(node.openFile)}${dirty ? " •" : ""}` : ""}
            </span>
            <div className="fb-menu-anchor" ref={settingsRef}>
              <button
                className={`fb-icon-btn round${settingsOpen ? " pressed" : ""}`}
                title="Configurações do editor"
                onClick={() => setSettingsOpen((o) => !o)}
              >
                <SlidersHorizontal size={15} />
              </button>
              {settingsOpen && (
                <div className="fb-popover fb-settings">
                  <div className="fbs-label">Fonte</div>
                  <div className="fbs-font-row">
                    <span className="fbs-font-name">{fontLabel}</span>
                    <span
                      className="fbs-font-size scrub-value"
                      title="Arraste para os lados para ajustar"
                      onPointerDown={(e) =>
                        scrubNumber(e, node.fontSize, (fontSize) => onChange(node.id, { fontSize }), {
                          min: FOLDER_FONT_MIN,
                          max: FOLDER_FONT_MAX,
                          pxPerUnit: 6,
                        })
                      }
                    >
                      {node.fontSize}pt
                    </span>
                    <button
                      className="fbs-btn"
                      onClick={(e) => {
                        if (fontAt) return setFontAt(null);
                        const r = e.currentTarget.getBoundingClientRect();
                        setFontAt({ x: r.left, y: r.bottom + 6 });
                      }}
                    >
                      Selecionar…
                    </button>
                  </div>
                  <div className="fbs-preview" style={{ fontFamily: fontCss }}>
                    abc 012 -&gt; | &lt;-
                  </div>

                  <div className="fbs-label">Tamanho da Tabulação</div>
                  <div className="fbs-segmented">
                    {([2, 4, 8] as TabSize[]).map((t) => (
                      <button
                        key={t}
                        className={node.tabSize === t ? "on" : ""}
                        onClick={() => onChange(node.id, { tabSize: t })}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="fbs-row">
                    <span>Quebrar Linhas</span>
                    <button
                      className={`st-toggle${node.wrap ? " on" : ""}`}
                      role="switch"
                      aria-checked={node.wrap}
                      onClick={() => onChange(node.id, { wrap: !node.wrap })}
                    />
                  </div>
                  <div className="fbs-row">
                    <span>Renderizar Markdown</span>
                    <button
                      className={`st-toggle${node.markdown ? " on" : ""}`}
                      role="switch"
                      aria-checked={node.markdown}
                      onClick={() => onChange(node.id, { markdown: !node.markdown })}
                    />
                  </div>
                </div>
              )}
            </div>
            <button className="fb-icon-btn" title="Salvar (Ctrl+S)" disabled={!dirty} onClick={save}>
              <Save size={15} />
            </button>
            {onToggleFullscreen && (
              <FullscreenButton active={fullscreen} size={15} onToggle={() => onToggleFullscreen(node.id)} />
            )}
            <button className="fb-icon-btn" title="Fechar arquivo" disabled={!node.openFile} onClick={closeFile}>
              <X size={15} />
            </button>
          </div>

          <div className="fb-body">
            {!node.openFile || !opened ? (
              <div className="fb-placeholder">Selecione um arquivo para visualizar</div>
            ) : opened.kind === "loading" ? null : opened.kind === "image" ? (
              <div className="fb-image fb-scroll">
                <img src={opened.url} alt={baseName(node.openFile)} draggable={false} />
              </div>
            ) : opened.kind === "binary" ? (
              <div className="fb-placeholder">Arquivo binário — não dá para mostrar como texto.</div>
            ) : opened.kind === "tooLarge" ? (
              <div className="fb-placeholder">Arquivo grande demais para abrir ({formatSize(opened.size)}).</div>
            ) : opened.kind === "error" ? (
              <div className="fb-placeholder">{opened.message}</div>
            ) : html ? (
              <div
                className="fb-markdown note-preview fb-scroll"
                style={{ fontSize: node.fontSize + 1 }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <>
                <textarea
                  ref={editorRef}
                  className={`fb-editor fb-scroll${node.wrap ? " wrap" : ""}`}
                  style={{ fontFamily: fontCss, fontSize: node.fontSize, tabSize: node.tabSize }}
                  value={opened.content}
                  spellCheck={false}
                  onChange={(e) => {
                    const content = e.target.value;
                    setOpened((o) => (o?.kind === "text" ? { ...o, content } : o));
                  }}
                  onKeyDown={onEditorKey}
                />
                <SmoothCaret textarea={editorRef} deps={[fontCss, node.fontSize, node.tabSize, node.wrap, node.openFile]} />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="node-resize" title="Redimensionar" onPointerDown={startResize} />

      {dragGhost &&
        createPortal(
          <div className="fb-drag-ghost" style={{ left: dragGhost.x + 14, top: dragGhost.y + 10 }}>
            {dragGhost.isDir ? <Folder size={14} /> : <File size={14} />}
            <span>{dragGhost.name}</span>
          </div>,
          document.body,
        )}

      {createPresence.mounted && createMenu && (
        <ContextMenu
          x={createMenu.x}
          y={createMenu.y}
          items={createItems}
          closing={createPresence.closing}
          onClose={() => setCreateMenu(null)}
        />
      )}

      {fontPresence.mounted && fontAt && (
        <NotePopover x={fontAt.x} y={fontAt.y} closing={fontPresence.closing} onClose={() => setFontAt(null)} className="np-font">
          <FontPicker
            current={node.font}
            onPick={(font) => {
              onChange(node.id, { font });
              setFontAt(null);
            }}
          />
        </NotePopover>
      )}
    </div>
  );
}

/** Campo do nome de um item novo. Enter confirma; Esc ou clicar fora cancela. */
function NameInput({ placeholder, onDone }: { placeholder: string; onDone: (name: string | null) => void }) {
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      className="fb-name-input"
      placeholder={placeholder}
      autoFocus
      spellCheck={false}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(null)}
    />
  );
}
