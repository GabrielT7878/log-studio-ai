import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FullscreenButton } from "./FullscreenButton";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCode,
  FolderOpen,
  Globe,
  RotateCw,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  normalizePortalFile,
  PORTAL_MIN_H,
  PORTAL_MIN_W,
  type NodePatch,
  type PortalNodeData,
} from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";

interface Props {
  node: PortalNodeData;
  space: string;
  projectId: string;
  zoom: number;
  selected: boolean;
  /** Foca a barra de endereço ao montar (portal recém-criado). */
  autoFocus: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: NodePatch) => void;
  /** Esta janela está em tela cheia. */
  fullscreen?: boolean;
  onToggleFullscreen?: (id: string) => void;
}

/**
 * Texto da barra de endereço → URL http(s). Sem esquema: https://, ou http:// para
 * localhost/IPs. Outros esquemas (javascript:, file:…) são recusados (null).
 */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : /^(localhost|127\.|0\.0\.0\.0|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/i.test(text)
      ? `http://${text}`
      : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** O que a barra de endereço pede: site, HTML do projeto ou caminho absoluto (seletor/colado). */
type Target = { url: string; file?: undefined } | { file: string; url?: undefined } | { absolute: string };

/**
 * Texto da barra → destino. "site/index.html" ou "index.html" é arquivo do projeto;
 * "exemplo.com/pagina.html" (1ª parte com ponto) é site; "C:\..." e file:/// vão ao backend.
 */
export function parseAddress(raw: string): Target | null {
  const text = raw.trim();
  if (/^[a-z]:[\\/]/i.test(text) || text.startsWith("\\\\")) return { absolute: text };
  if (/^file:\/\/\//i.test(text)) {
    try {
      return { absolute: decodeURIComponent(text.slice(8)) };
    } catch {
      return null;
    }
  }
  const file = normalizePortalFile(text);
  if (file) {
    const parts = file.split("/");
    if (parts.length === 1 || !parts[0].includes(".")) return { file };
  }
  const url = normalizeUrl(text);
  return url ? { url } : null;
}

type Status = "idle" | "checking" | "ok" | "blocked" | "error";

/** Entrada do histórico do Portal. */
type Entry = { url: string; file?: string };

const entryOf = (n: { url: string; file?: string }): Entry | null =>
  n.file ? { url: "", file: n.file } : n.url ? { url: n.url } : null;
const sameEntry = (a: Entry, b: Entry) => a.url === b.url && a.file === b.file;

/** Portal: página web ou HTML do projeto dentro do canvas (iframe). */
export function PortalNode({
  node,
  space,
  projectId,
  zoom,
  selected,
  autoFocus,
  onSelect,
  onChange,
  fullscreen = false,
  onToggleFullscreen,
}: Props) {
  const shown = node.file ?? node.url;
  const [address, setAddress] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState<Status>(shown ? "checking" : "idle");
  const [error, setError] = useState("");
  /** Erro ao escolher/colar um caminho (ex.: fora do projeto); some na próxima navegação. */
  const [pickError, setPickError] = useState("");
  /** Endereço que o iframe carrega (site ou URL do servidor local). */
  const [frameSrc, setFrameSrc] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  // Histórico dos endereços digitados (o app não enxerga a navegação dentro de outro site).
  const [history, setHistory] = useState(() => {
    const first = entryOf(node);
    return { stack: first ? [first] : [], index: first ? 0 : -1 };
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao criar
  }, []);

  // Mudou o destino: mostra no campo. Site: confere se permite ser embutido.
  // HTML do projeto: pede ao backend a URL do servidor local.
  useEffect(() => {
    setAddress(node.file ?? node.url);
    setError("");
    setFrameSrc("");
    if (!node.file && !node.url) {
      setStatus("idle");
      return;
    }
    let alive = true;
    setStatus("checking");
    if (node.file) {
      api
        .portalLocalUrl(space, projectId, node.file)
        .then((src) => {
          if (!alive) return;
          setFrameSrc(src);
          setStatus("ok");
        })
        .catch((e) => {
          if (!alive) return;
          setError(String(e));
          setStatus("error");
        });
    } else {
      const url = node.url;
      setFrameSrc(url);
      api
        .portalCheck(url)
        .then((r) => alive && setStatus(r.blocked ? "blocked" : "ok"))
        .catch(() => alive && setStatus("ok"));
    }
    return () => {
      alive = false;
    };
  }, [node.url, node.file, space, projectId]);

  const go = (entry: Entry) => {
    setPickError("");
    const current = entryOf(node);
    if (current && sameEntry(current, entry)) {
      setReloadKey((k) => k + 1);
      return;
    }
    setHistory((h) => ({ stack: [...h.stack.slice(0, h.index + 1), entry], index: h.index + 1 }));
    onChange(node.id, { url: entry.url, file: entry.file });
  };

  /** Caminho absoluto (seletor ou colado) → HTML do projeto. */
  const goAbsolute = async (path: string) => {
    try {
      const rel = await api.portalRelativePath(space, projectId, path);
      const file = normalizePortalFile(rel);
      if (!file) throw new Error("O Portal só abre arquivos .html ou .htm.");
      setInvalid(false);
      go({ url: "", file });
    } catch (e) {
      setInvalid(true);
      setPickError(e instanceof Error ? e.message : String(e));
    }
  };

  const navigate = (raw: string) => {
    const target = parseAddress(raw);
    setPickError("");
    if (!target) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if ("absolute" in target) {
      void goAbsolute(target.absolute);
      return;
    }
    go(target.file ? { url: "", file: target.file } : { url: target.url ?? "" });
  };

  const pickFile = async () => {
    let defaultPath: string | undefined;
    try {
      const { projectsRoot } = await api.getSettings();
      defaultPath = [projectsRoot, space, ...projectId.split("/")].join("\\");
    } catch {
      // Sem a pasta do projeto o seletor abre na última pasta usada.
    }
    const picked = await openFileDialog({
      multiple: false,
      directory: false,
      title: "Abrir arquivo HTML",
      defaultPath,
      filters: [{ name: "Página HTML", extensions: ["html", "htm"] }],
    });
    if (typeof picked === "string") await goAbsolute(picked);
  };

  const step = (delta: number) => {
    const index = history.index + delta;
    if (index < 0 || index >= history.stack.length) return;
    setHistory({ ...history, index });
    const entry = history.stack[index];
    onChange(node.id, { url: entry.url, file: entry.file });
  };

  const openExternal = () => {
    if (frameSrc) openUrl(frameSrc).catch((e) => console.warn(e));
  };

  /** Arrastar pelo espaço vazio do cabeçalho move o card. */
  const onHeaderDown = (e: React.PointerEvent<HTMLElement>) => {
    onSelect(node.id);
    if (e.target !== e.currentTarget) return;
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { w, h } = node;
    dragPointer(e, (dx, dy) =>
      onChange(node.id, { w: Math.max(PORTAL_MIN_W, w + dx / zoom), h: Math.max(PORTAL_MIN_H, h + dy / zoom) }),
    );
  };

  return (
    <div
      className={`canvas-node portal-node${selected ? " selected" : ""}${fullscreen ? " fullscreen" : ""}`}
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
      <div className="pt-inner">
        <div className="pt-header" onPointerDown={onHeaderDown}>
          <button className="fb-icon-btn" title="Voltar" disabled={history.index <= 0} onClick={() => step(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button
            className="fb-icon-btn"
            title="Avançar"
            disabled={history.index >= history.stack.length - 1}
            onClick={() => step(1)}
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="fb-icon-btn"
            title="Recarregar"
            disabled={!shown}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RotateCw size={14} />
          </button>
          <form
            className={`pt-address${invalid ? " invalid" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              navigate(address);
              inputRef.current?.blur();
            }}
          >
            {node.file ? <FileCode size={13} /> : <Globe size={13} />}
            <input
              ref={inputRef}
              value={address}
              placeholder="Endereço (ex.: localhost:3000) ou arquivo do projeto (ex.: site/index.html)"
              spellCheck={false}
              onChange={(e) => {
                setAddress(e.target.value);
                setInvalid(false);
              }}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setAddress(shown);
                  setInvalid(false);
                  e.currentTarget.blur();
                }
              }}
            />
          </form>
          <button className="fb-icon-btn" title="Abrir arquivo HTML" onClick={() => void pickFile()}>
            <FolderOpen size={15} />
          </button>
          <button className="fb-icon-btn" title="Abrir no navegador" disabled={!frameSrc} onClick={openExternal}>
            <ExternalLink size={15} />
          </button>
          {onToggleFullscreen && (
            <FullscreenButton active={fullscreen} size={15} onToggle={() => onToggleFullscreen(node.id)} />
          )}
        </div>

        <div className="pt-body">
          {pickError || status === "error" ? (
            <div className="pt-message">
              <TriangleAlert size={28} />
              <span>{pickError || error || "Não foi possível abrir."}</span>
            </div>
          ) : !shown ? (
            <div className="pt-message">
              <Globe size={28} />
              <span>Digite um endereço na barra acima e tecle Enter, ou abra um arquivo HTML do projeto.</span>
            </div>
          ) : status === "blocked" ? (
            <div className="pt-message">
              <ShieldAlert size={28} />
              <span>Este site não permite ser exibido dentro do app.</span>
              <button className="pt-open-btn" onClick={openExternal}>
                <ExternalLink size={14} /> Abrir no navegador
              </button>
            </div>
          ) : !frameSrc ? null : (
            <iframe
              key={`${frameSrc}#${reloadKey}`}
              className="pt-frame"
              src={frameSrc}
              title={shown}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </div>
      </div>

      <div className="node-resize" title="Redimensionar" onPointerDown={startResize} />
    </div>
  );
}
