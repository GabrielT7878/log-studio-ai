import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Settings,
  SquarePlus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../hooks/usePresence";
import { api } from "../lib/api";
import { useSpaces } from "../hooks/useSpaces";
import { useToast } from "../hooks/useToast";
import { useTreeDrag } from "../hooks/useTreeDrag";
import {
  findActiveProject,
  isArchiveFolder,
  useWorkspaceTree,
  type FolderNode,
  type ProjectNode,
  type TreeNode,
} from "../hooks/useWorkspaceTree";
import { filterTree } from "../lib/filterTree";
import type { ActiveProject } from "./Canvas";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { NameModal } from "./NameModal";
import { ProjectWheel, touchRecentProject } from "./ProjectWheel";
import { WorkspaceTree } from "./WorkspaceTree";

// Limites de largura da sidebar (px)
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 352;
const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));

/** Tempo mínimo da splash screen na tela (ms). */
const SPLASH_MIN_MS = 1000;
/** A splash só é fechada uma vez (trocar de espaço depois não a chama de novo). */
let splashClosed = false;

/** O que vai para a Lixeira: um item da árvore ou um espaço de trabalho inteiro. */
type DeleteTarget = { kind: "node"; node: TreeNode } | { kind: "space"; name: string };

function deleteDetail(t: DeleteTarget): string {
  if (t.kind === "space") {
    return "O espaço de trabalho e todas as pastas e projetos dentro dele serão movidos para a Lixeira do Windows.";
  }
  const n = t.node;
  if (n.kind === "project") {
    return "O diretório do projeto e todo o seu conteúdo serão movidos para a Lixeira do Windows.";
  }
  const count = n.children.length;
  return count > 0
    ? `A pasta e tudo o que está dentro dela (${count} ${count === 1 ? "item" : "itens"}) serão movidos para a Lixeira do Windows.`
    : "A pasta será movida para a Lixeira do Windows.";
}

/** Modal de nome de espaço: criar um novo ou renomear o atual. */
type NameTarget = { mode: "create" } | { mode: "rename"; name: string };

type MenuKind = "context" | "space";

export function Sidebar({
  collapsed,
  rootVersion,
  onActiveProjectChange,
  onOpenSettings,
  onNewGroup,
}: {
  collapsed: boolean;
  /** Muda quando o diretório raiz dos projetos é trocado nas configurações. */
  rootVersion: number;
  /** Projeto aberto no canvas (null = nenhum). */
  onActiveProjectChange: (project: ActiveProject | null) => void;
  onOpenSettings: () => void;
  onNewGroup: () => void;
}) {
  const toast = useToast();
  const spaces = useSpaces(rootVersion, toast.show);
  const {
    tree,
    treeSpace,
    loaded,
    editingId,
    createFolder,
    createProject,
    startRename,
    rename,
    toggleFolder,
    deleteNode,
    archiveNode,
    unarchiveNode,
    moveNode,
    selectProject,
    openInExplorer,
  } = useWorkspaceTree(spaces.current, rootVersion, toast.show);

  // Splash screen: mostra o andamento e fecha quando a primeira árvore carregar.
  useEffect(() => {
    if (splashClosed) return;
    void api
      .splashStatus(spaces.current ? `Abrindo ${spaces.current}…` : "Carregando espaços…")
      .catch(() => {});
  }, [spaces.current]);
  useEffect(() => {
    if (!loaded || splashClosed) return;
    splashClosed = true;
    // Fica pelo menos SPLASH_MIN_MS na tela (desde o início da página) para não piscar.
    const wait = Math.max(0, SPLASH_MIN_MS - performance.now());
    setTimeout(() => void api.splashDone().catch(() => {}), wait);
  }, [loaded]);

  // Avisa o App qual projeto está aberto (o canvas mostra o projeto dele).
  const active = useMemo(() => findActiveProject(tree), [tree]);
  const onActiveRef = useRef(onActiveProjectChange);
  onActiveRef.current = onActiveProjectChange;
  useEffect(() => {
    const space = spaces.current;
    // Logo depois de trocar/renomear o espaço, `tree` ainda é a do espaço anterior (com os
    // cards lidos quando ela carregou): espera a árvore do espaço atual chegar.
    if (space && treeSpace !== space) return;
    // Histórico de recentes da roda de projetos (Ctrl+Tab).
    if (space && active) touchRecentProject(space, active.id);
    onActiveRef.current(
      active && space
        ? {
            space,
            id: active.id,
            name: active.name,
            color: active.color,
            view: active.view,
            canvas: active.canvas,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só muda quando o projeto aberto muda
  }, [spaces.current, treeSpace, active?.id, active?.name, active?.color]);

  const listRef = useRef<HTMLElement>(null);
  const drag = useTreeDrag(listRef, moveNode);

  /** Copia o caminho completo da pasta/projeto no disco (raiz\espaço\Pasta\Projeto). */
  const copyPath = async (id: string) => {
    const space = spaces.current;
    if (!space) return;
    try {
      const { projectsRoot } = await api.getSettings();
      const path = [projectsRoot.replace(/[\\/]+$/, ""), space, ...id.split("/")].join("\\");
      // Com espaço (ou outro caractere especial do terminal): entre aspas, para colar e usar direto.
      await navigator.clipboard.writeText(/[\s&()^;,'`$]/.test(path) ? `"${path}"` : path);
    } catch (e) {
      toast.show(`Não foi possível copiar o caminho: ${e}`);
    }
  };

  // ---- Pesquisa ----
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  // A pasta Arquivados sai da árvore principal e aparece numa seção própria no fim.
  const archived = useMemo(() => tree.find(isArchiveFolder), [tree]);
  const mainTree = useMemo(() => tree.filter((n) => !isArchiveFolder(n)), [tree]);
  const visibleTree = useMemo(() => filterTree(mainTree, query), [mainTree, query]);
  // Durante a pesquisa, arrastar fica desativado.
  const noDrag = useMemo(() => ({ dragId: null, target: null, start: () => {} }), []);

  // Criar limpa a pesquisa, para o item novo (com o nome em edição) aparecer.
  const newFolder = (parent: string | null) => {
    setQuery("");
    void createFolder(parent);
  };
  const newProject = (parent: string | null) => {
    setQuery("");
    void createProject(parent);
  };

  // ---- Confirmação de exclusão (itens e espaços) ----
  const [toDelete, setToDelete] = useState<DeleteTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirm = usePresence(confirmOpen, 160);
  const askDelete = (target: DeleteTarget) => {
    setToDelete(target);
    setConfirmOpen(true);
  };

  /** Menu de um item dentro da seção Arquivados. */
  const archivedMenu = (n: FolderNode | ProjectNode): ContextMenuItem[] => [
    { label: "Desarquivar", icon: ArchiveRestore, onSelect: () => void unarchiveNode(n.id) },
    { label: "Copiar caminho", icon: ClipboardCopy, divider: true, onSelect: () => void copyPath(n.id) },
    { label: "Abrir no Explorer", icon: FolderOpen, onSelect: () => openInExplorer(n.id) },
    {
      label: "Excluir",
      icon: Trash2,
      danger: true,
      onSelect: () => askDelete({ kind: "node", node: n }),
    },
  ];

  // ---- Modal de nome do espaço (novo / renomear) ----
  const [nameTarget, setNameTarget] = useState<NameTarget | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameKey, setNameKey] = useState(0); // remonta o modal a cada abertura
  const nameModal = usePresence(nameOpen, 160);
  const openNameModal = (target: NameTarget) => {
    setNameTarget(target);
    setNameKey((k) => k + 1);
    setNameOpen(true);
  };

  // ---- Menu (clique direito e seletor de espaço) ----
  const [menuState, setMenuState] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
    kind: MenuKind;
  }>({ x: 0, y: 0, items: [], kind: "context" });
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = usePresence(menuOpen, 110);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const openMenuAt = (x: number, y: number, items: ContextMenuItem[], kind: MenuKind) => {
    setMenuState({ x, y, items, kind });
    setMenuOpen(true);
  };

  const openMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY, items, "context");
  };

  // Clique direito no espaço vazio da sidebar
  const sidebarMenu: ContextMenuItem[] = [
    { label: "Nova pasta", icon: FolderPlus, onSelect: () => newFolder(null) },
    { label: "Novo projeto", icon: SquarePlus, onSelect: () => newProject(null) },
  ];

  // Menu do seletor de espaço de trabalho
  const spaceMenu = (): ContextMenuItem[] => {
    const current = spaces.current;
    const items: ContextMenuItem[] = spaces.spaces.map((name) => ({
      label: name,
      checked: name === current,
      onSelect: () => name !== current && spaces.select(name),
    }));
    items.push({
      label: "Novo espaço de trabalho…",
      icon: Plus,
      divider: true,
      onSelect: () => openNameModal({ mode: "create" }),
    });
    if (current) {
      items.push({
        label: "Renomear espaço…",
        icon: Pencil,
        onSelect: () => openNameModal({ mode: "rename", name: current }),
      });
      if (spaces.spaces.length > 1) {
        items.push({
          label: "Excluir espaço",
          icon: Trash2,
          danger: true,
          onSelect: () => askDelete({ kind: "space", name: current }),
        });
      }
    }
    return items;
  };

  const toggleSpaceMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (menuOpen && menuState.kind === "space") {
      setMenuOpen(false);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    openMenuAt(r.left, r.bottom + 4, spaceMenu(), "space");
  };

  // ---- Largura ajustável ----
  const [width, setWidth] = useState(SIDEBAR_DEFAULT);
  const [resizing, setResizing] = useState(false);

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startW = width;
    el.setPointerCapture(e.pointerId);
    setResizing(true);
    document.documentElement.style.cursor = "col-resize";

    const onMove = (ev: PointerEvent) => setWidth(clampWidth(startW + ev.clientX - startX));
    const onUp = () => {
      setResizing(false);
      document.documentElement.style.cursor = "";
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  return (
    <aside
      className={`sidebar${collapsed ? " collapsed" : ""}${resizing ? " resizing" : ""}`}
      style={{ "--sidebar-w": `${width}px` } as React.CSSProperties}
      inert={collapsed}
      onContextMenu={(e) => {
        // Ignora cliques vindos de portais (modal, menu, aviso) que "sobem" pelo React.
        if (!e.currentTarget.contains(e.target as Node)) return;
        // Só a lista tem este menu; a parte de cima (Pesquisar, +, seletor de
        // espaço e os vãos entre eles) e o rodapé não têm.
        if (!(e.target as HTMLElement).closest(".workspace-list")) return;
        openMenu(e, sidebarMenu);
      }}
    >
      {menu.mounted && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={menuState.items}
          closing={menu.closing}
          onClose={closeMenu}
        />
      )}
      <div className="sidebar-inner">
        {/* Área de arrastar a janela, no espaço acima do "Pesquisar" */}
        <div className="drag-region sidebar-drag" data-tauri-drag-region />
        <div className="sidebar-top">
          <label className="search">
            <Search size={16} />
            <input
              placeholder="Pesquisar"
              value={query}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
            {searching && (
              <button
                className="search-clear"
                title="Limpar pesquisa"
                onClick={(e) => {
                  e.preventDefault();
                  setQuery("");
                }}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <button
            className="icon-btn"
            title="Novo espaço de trabalho"
            onClick={() => openNameModal({ mode: "create" })}
          >
            <Plus size={18} />
          </button>
        </div>

        {/* Seletor de espaço de trabalho */}
        <button
          className={`space-switcher${menuOpen && menuState.kind === "space" ? " open" : ""}`}
          title="Trocar espaço de trabalho"
          // Evita que o "clicar fora" do menu feche e o clique reabra em seguida.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleSpaceMenu}
          // Clique direito também abre o menu de espaços (na posição do cursor).
          onContextMenu={(e) => {
            e.stopPropagation();
            openMenuAt(e.clientX, e.clientY, spaceMenu(), "space");
          }}
        >
          <span className="space-switcher-name">{spaces.current ?? "…"}</span>
          <ChevronDown size={13} />
        </button>

        <nav className="workspace-list" ref={listRef}>
          <WorkspaceTree
            tree={visibleTree}
            editingId={editingId}
            dnd={searching ? noDrag : drag}
            onToggle={toggleFolder}
            onSelectProject={selectProject}
            onRename={rename}
            onFolderMenu={(e, f) =>
              openMenu(e, [
                { label: "Copiar caminho", icon: ClipboardCopy, onSelect: () => void copyPath(f.id) },
                { label: "Nova pasta", icon: FolderPlus, divider: true, onSelect: () => newFolder(f.id) },
                { label: "Novo projeto", icon: SquarePlus, onSelect: () => newProject(f.id) },
                { label: "Abrir no Explorer", icon: FolderOpen, divider: true, onSelect: () => openInExplorer(f.id) },
                { label: "Renomear", icon: Pencil, onSelect: () => startRename(f.id) },
                { label: "Arquivar", icon: Archive, onSelect: () => void archiveNode(f.id) },
                {
                  label: "Excluir",
                  icon: Trash2,
                  danger: true,
                  onSelect: () => askDelete({ kind: "node", node: f }),
                },
              ])
            }
            onProjectMenu={(e, p) =>
              openMenu(e, [
                { label: "Copiar caminho", icon: ClipboardCopy, onSelect: () => void copyPath(p.id) },
                { label: "Abrir no Explorer", icon: FolderOpen, onSelect: () => openInExplorer(p.id) },
                { label: "Renomear", icon: Pencil, onSelect: () => startRename(p.id) },
                { label: "Arquivar", icon: Archive, onSelect: () => void archiveNode(p.id) },
                {
                  label: "Excluir",
                  icon: Trash2,
                  danger: true,
                  onSelect: () => askDelete({ kind: "node", node: p }),
                },
              ])
            }
          />
          {/* Indicador de "soltar no fim da lista" */}
          {drag.dragId && drag.target?.id === null && <div className="tree-drop-end" />}

          {/* Seção Arquivados (recolhida por padrão; some durante a pesquisa) */}
          {archived && !searching && (
            <div className="archive-section" data-archive-section>
              <button
                className="archive-header"
                aria-expanded={archived.expanded}
                onClick={() => toggleFolder(archived.id)}
              >
                {archived.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Archive size={14} />
                <span>Arquivados ({archived.children.length})</span>
              </button>
              {archived.expanded &&
                (archived.children.length === 0 ? (
                  <div className="archive-empty">Nenhum item arquivado.</div>
                ) : (
                  <WorkspaceTree
                    tree={archived.children}
                    editingId={editingId}
                    dnd={noDrag}
                    onToggle={toggleFolder}
                    onSelectProject={selectProject}
                    onRename={rename}
                    onFolderMenu={(e, f) => openMenu(e, archivedMenu(f))}
                    onProjectMenu={(e, p) => openMenu(e, archivedMenu(p))}
                  />
                ))}
            </div>
          )}

          {searching && visibleTree.length === 0 && (
            <div className="tree-empty-root">Nenhum resultado para “{query.trim()}”.</div>
          )}

          {loaded && !searching && mainTree.length === 0 && (
            <div className="tree-empty-root">
              Nenhum projeto ainda.
              <br />
              Clique com o botão direito para criar.
            </div>
          )}
        </nav>

        {/* Etiqueta que segue o cursor durante o arraste */}
        {drag.ghost &&
          createPortal(
            <div className="tree-ghost" style={{ left: drag.ghost.x, top: drag.ghost.y }}>
              {drag.ghost.label}
            </div>,
            document.body,
          )}

        <footer className="sidebar-footer">
          <button className="new-group" onClick={onNewGroup}>
            <Folder size={14} />
            <span>Novo grupo</span>
          </button>
          <div className="footer-actions">
            <button className="icon-btn small" title="Rotinas">
              <AlarmClock size={14} />
            </button>
            <button className="icon-btn small" title="Configurações" onClick={onOpenSettings}>
              <Settings size={14} />
            </button>
          </div>
        </footer>
      </div>

      {/* Alça para ajustar a largura (arrastar a borda direita) */}
      <div className="sidebar-resizer" onPointerDown={onResizeStart} />

      {confirm.mounted && toDelete && (
        <ConfirmDeleteModal
          name={toDelete.kind === "space" ? toDelete.name : toDelete.node.name}
          detail={deleteDetail(toDelete)}
          closing={confirm.closing}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            if (toDelete.kind === "space") void spaces.remove(toDelete.name);
            else void deleteNode(toDelete.node.id);
          }}
        />
      )}

      {nameModal.mounted && nameTarget && (
        <NameModal
          key={nameKey}
          title={nameTarget.mode === "create" ? "Novo espaço de trabalho" : "Renomear espaço"}
          label="Nome do espaço"
          initialValue={nameTarget.mode === "rename" ? nameTarget.name : ""}
          confirmLabel={nameTarget.mode === "create" ? "Criar" : "Salvar"}
          closing={nameModal.closing}
          onCancel={() => setNameOpen(false)}
          onConfirm={async (name) => {
            const ok =
              nameTarget.mode === "create"
                ? await spaces.create(name)
                : await spaces.rename(nameTarget.name, name);
            if (ok) setNameOpen(false);
          }}
        />
      )}

      {/* Roda de troca de projeto (Ctrl+Tab) */}
      <ProjectWheel
        space={treeSpace === spaces.current ? spaces.current : null}
        tree={tree}
        activeId={active?.id}
        onSelect={selectProject}
      />

      {/* Aviso de erro */}
      {toast.presence.mounted &&
        createPortal(
          <div
            className={`toast${toast.presence.closing ? " closing" : ""}`}
            role="alert"
            onClick={toast.hide}
          >
            {toast.message}
          </div>,
          document.body,
        )}
    </aside>
  );
}
