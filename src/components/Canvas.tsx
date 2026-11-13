import {
  AArrowUp,
  Bold,
  BookOpen,
  Bot,
  Braces,
  CaseSensitive,
  Ellipsis,
  Hash,
  Image,
  Link2,
  Unlink2,
  LayoutList,
  Italic,
  List,
  ListChecks,
  Palette,
  Strikethrough,
  ChevronDown,
  CircleDot,
  Code,
  Folder,
  GitBranch,
  Globe,
  Layers,
  Map as MapIcon,
  Menu,
  MessagesSquare,
  Minus,
  MousePointer2,
  PanelBottom,
  Paperclip,
  Pencil,
  PenTool,
  Plus,
  RotateCw,
  Scroll,
  Square,
  SquareCode,
  SquarePen,
  SquareTerminal,
  ChevronUp,
  Play,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useCanvasNodes } from "../hooks/useCanvasNodes";
import { useCanvasPan, ZOOM_MAX, ZOOM_MIN } from "../hooks/useCanvasPan";
import { useAgentActivity } from "../hooks/useAgentActivity";
import { usePresence } from "../hooks/usePresence";
import { useToast } from "../hooks/useToast";
import type { CanvasView } from "../hooks/useWorkspaceTree";
import { runTool, ToolError, type AgentRequest } from "../lib/agentTools";
import { api, type Attached } from "../lib/api";
import { attachmentKind, attachmentSize, IMAGE_FILE_EXT } from "../lib/attachments";
import { forgetScene, loadScene, setScene } from "../lib/boardScenes";
import { imageSize, imageUrl } from "../lib/canvasImages";
import {
  AGENTS,
  BOARD_DEFAULT_H,
  BOARD_DEFAULT_TITLE,
  BOARD_DEFAULT_W,
  type BoardNodeData,
  NODE_DEFAULT_H,
  NODE_DEFAULT_W,
  NODE_MIN_H,
  NODE_MIN_W,
  FOLDER_DEFAULTS,
  PORTAL_DEFAULT_H,
  PORTAL_DEFAULT_W,
  FOLDER_DEFAULT_H,
  FOLDER_DEFAULT_W,
  IMAGE_INITIAL_MAX,
  NOTE_DEFAULTS,
  TEXT_DEFAULTS,
  TEXT_FAMILIES,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_SIZE_STEP,
  TEXT_WEIGHTS,
  type TextFamily,
  type TextNodeData,
  type TextWeight,
  getLastNoteColor,
  setLastNoteColor,
  NOTE_DEFAULT_H,
  NOTE_DEFAULT_W,
  NOTE_MIN_H,
  NOTE_MIN_W,
  minSize,
  normalizeGroups,
  type AgentKind,
  type AttachmentNodeData,
  type CanvasNodeData,
  type FolderNodeData,
  type PortalNodeData,
  type ImageNodeData,
  type NodePatch,
  type NoteNodeData,
  type TerminalNodeData,
  SCRIPT_COLLAPSED_H,
  SCRIPT_DEFAULT_OPEN_H,
  SCRIPT_DEFAULT_TITLE,
  SCRIPT_DEFAULT_W,
  SCRIPT_MIN_OPEN_H,
  type ScriptNodeData,
  TERM_FONT_DEFAULT,
} from "../lib/canvasNodes";
import { applyFormat, restoreSelection, type FormatKind } from "../lib/noteFormat";
import { dragPointer } from "../lib/dragPointer";
import { scrubNumber } from "../lib/scrub";
import * as terminals from "../lib/terminals";
import { useAgentUsage } from "../hooks/useAgentUsage";
import { AgentUsagePopover, pillRings, pillText } from "./AgentUsagePopover";
import { AttachmentNode } from "./AttachmentNode";
import { BoardNode } from "./BoardNode";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FolderNode } from "./FolderNode";
import { ImageNode } from "./ImageNode";
import { NoteNode } from "./NoteNode";
import { PortalNode } from "./PortalNode";
import { ColorPicker, FontPicker, FontSizeStepper, HeadingMenu, NotePopover, TextColorPicker } from "./NotePopover";
import { RingGauge } from "./RingGauge";
import { ScriptNode, scriptStatusText, useScriptState, type ScriptAction } from "./ScriptNode";
import { TerminalNode } from "./TerminalNode";
import { TextNode } from "./TextNode";

const appWindow = getCurrentWindow();

type ToolId = "select" | "terminal" | "script" | "note" | "attach" | "folder" | "portal" | "text" | "draw";

const tools: { id: ToolId; icon: typeof MousePointer2; label: string }[] = [
  { id: "select", icon: MousePointer2, label: "Selecionar" },
  { id: "terminal", icon: SquareTerminal, label: "Terminal" },
  { id: "script", icon: SquareCode, label: "Script" },
  { id: "note", icon: Scroll, label: "Nota" },
  { id: "attach", icon: Paperclip, label: "Anexo" },
  { id: "folder", icon: Folder, label: "Pasta" },
  { id: "portal", icon: Globe, label: "Portal" },
  { id: "text", icon: Type, label: "Texto" },
  { id: "draw", icon: Pencil, label: "Desenhar" },
];
// Ferramentas que já funcionam (as outras são só visuais por enquanto).
const WORKING_TOOLS: ToolId[] = ["select", "terminal", "script", "note", "attach", "folder", "portal", "text", "draw"];
// Ferramentas que criam um card desenhando um retângulo (precisam de projeto aberto).
// "draw" cria um Quadro (Excalidraw).
const DRAW_TOOLS: ToolId[] = ["terminal", "script", "note", "folder", "portal", "draw"];

/** Janelas que podem ir para tela cheia (texto solto e Script não vão). */
const canFullscreen = (n: CanvasNodeData) => n.type !== "text" && n.type !== "script";

/** Projeto aberto no canvas. */
export interface ActiveProject {
  space: string;
  id: string;
  name: string;
  color: string;
  /** Posição/zoom salvos no disco. */
  view?: CanvasView;
  /** Cards salvos no disco (validados ao carregar). */
  canvas?: unknown;
}

const DEFAULT_VIEW: CanvasView = { x: 0, y: 0, zoom: 1 };
const SAVE_VIEW_DELAY_MS = 500;
const DRAW_CLICK_THRESHOLD = 8; // px: abaixo disso, o clique cria no tamanho padrão
const FS_SWITCH_MS = 420; // duração do deslize ao trocar de janela em tela cheia
const PASTE_TEXT_MAX = 80; // Ctrl+V: uma linha com até isso de caracteres vira texto solto; o resto, nota

/** Botão da segunda barra (sem `onClick` = só visual por enquanto). */
interface NodeAction {
  icon?: ComponentType<{ size?: number }>;
  /** Conteúdo no lugar do ícone (ex.: "R", "Sans", bolinha de cor). */
  content?: ReactNode;
  /** Só mostra um valor (não é botão), ex.: o tamanho do texto. */
  display?: boolean;
  /** Valor arrastável (cursor ↔). */
  onScrub?: (e: React.PointerEvent<HTMLElement>) => void;
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Destacado em azul (ex.: modo Markdown formatado ligado). */
  active?: boolean;
  /** Abre um painel abaixo do botão (em vez de agir direto). */
  popover?: PopoverKind;
}

/** Ícone "M" (Markdown) num quadrado, como no Maestri. */
function MarkdownIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7.5 16V8l4.5 5 4.5-5v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Selection {
  ids: string[];
  focus: string | null;
  /** Grupo conectado selecionado pelo retângulo dele (as janelas não ficam destacadas). */
  group: string | null;
}
const EMPTY_SELECTION: Selection = { ids: [], focus: null, group: null };

/** Retângulo (mundo) em volta de cada grupo conectado. */
function groupBoxes(list: CanvasNodeData[]) {
  const groups = new Set(list.filter((n) => n.group).map((n) => n.group!));
  return [...groups].map((group) => {
    const members = list.filter((n) => n.group === group);
    const x = Math.min(...members.map((n) => n.x));
    const y = Math.min(...members.map((n) => n.y));
    const r = Math.max(...members.map((n) => n.x + n.w));
    const b = Math.max(...members.map((n) => n.y + n.h));
    return { group, x, y, w: r - x, h: b - y };
  });
}

/** Painéis da barra da nota. */
type PopoverKind = "color" | "size" | "font" | "heading" | "textColor";

/** Retângulo em coordenadas de tela, relativas ao canvas. */
interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function Canvas({
  project,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  project: ActiveProject | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const [usageOpen, setUsageOpen] = useState(false);
  const usage = usePresence(usageOpen, 150);
  // Uso do plano dos agentes: lido ao abrir o app, a cada 5 min e ao abrir o popover (se velho).
  const agentUsage = useAgentUsage();
  const { refreshIfStale } = agentUsage;
  useEffect(() => {
    if (usageOpen) refreshIfStale();
  }, [usageOpen, refreshIfStale]);
  const agentsRef = useRef<HTMLDivElement>(null);

  // ---- Visualização por projeto (posição/zoom) ----
  const projectRef = useRef(project);
  projectRef.current = project;
  // Última visão de cada projeto nesta sessão (mais recente que a do disco).
  const viewCache = useRef(new Map<string, CanvasView>());
  const pending = useRef<{ space: string; id: string; view: CanvasView } | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const projectKey = project ? `${project.space}\n${project.id}` : null;

  /** Salva agora a visão pendente (se houver). */
  const flushView = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const p = pending.current;
    pending.current = null;
    if (p) api.saveProjectView(p.space, p.id, p.view).catch((e) => console.warn(e));
  }, []);

  // Janela em tela cheia (id) — salva junto com a visão do projeto.
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const fullscreenRef = useRef<string | null>(null);
  fullscreenRef.current = fullscreenId;
  // Troca animada entre janelas em tela cheia: a que está saindo continua visível durante
  // o deslize (dir 1 = foi para a próxima: a nova entra pela direita).
  const [fsLeaving, setFsLeaving] = useState<{ id: string; dir: 1 | -1 } | null>(null);

  /** Guarda a visão (com a janela em tela cheia) e salva depois de uma pausa. */
  const queueViewSave = (view: CanvasView) => {
    const p = projectRef.current;
    if (!p) return;
    const full: CanvasView = { x: view.x, y: view.y, zoom: view.zoom, fullscreen: fullscreenRef.current };
    viewCache.current.set(`${p.space}\n${p.id}`, full);
    pending.current = { space: p.space, id: p.id, view: full };
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushView, SAVE_VIEW_DELAY_MS);
  };

  const pan = useCanvasPan({
    // Usuário mexeu no canvas: guarda e salva depois de uma pausa.
    onChange: (view) => queueViewSave(view),
    // Em tela cheia o canvas fica parado (sem pan/zoom por roda ou arraste).
    locked: () => nodesRef.current.some((n) => n.id === fullscreenRef.current && canFullscreen(n)),
  });

  // ---- Cards (terminais) do projeto ----
  const { nodes, update } = useCanvasNodes(project);
  // Seleção: `ids` = janelas destacadas (várias, por arraste ou grupo);
  // `focus` = a janela cuja barra de ações aparece (null quando há várias).
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const selectedId = selection.focus;

  /** Ids do grupo da janela (ou só ela, se não estiver conectada). */
  const groupIds = (id: string, list = nodesRef.current) => {
    const g = list.find((n) => n.id === id)?.group;
    return g ? list.filter((n) => n.group === g).map((n) => n.id) : [id];
  };

  /** Seleciona só esta janela (mesmo conectada) e mostra a barra dela. */
  const setSelectedId = useCallback((id: string | null) => {
    setSelection(id ? { ids: [id], focus: id, group: null } : EMPTY_SELECTION);
  }, []);

  /**
   * Clique numa janela: seleciona só ela (conectada ou não; arrastar move o grupo junto).
   * Se ela já faz parte de uma seleção múltipla, mantém a seleção (para arrastar todas).
   */
  /** Tira o destaque do agente da janela (ligado depois que `activity` existe). */
  const clearAgentMark = useRef<(id: string) => void>(() => {});
  const selectNode = useCallback((id: string) => {
    clearAgentMark.current(id); // o usuário clicou na janela: o destaque do agente some
    const cur = selectionRef.current;
    if (cur.ids.includes(id) && cur.ids.length > 1) return;
    setSelection({ ids: [id], focus: id, group: null });
  }, []);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  /** Script com o campo do comando aberto. */
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>("select");

  // Trocou de projeto: salva a visão anterior, restaura a do novo e limpa a seleção.
  useEffect(() => {
    flushView();
    const p = projectRef.current;
    const view = projectKey ? (viewCache.current.get(projectKey) ?? p?.view ?? DEFAULT_VIEW) : DEFAULT_VIEW;
    pan.setView(view);
    // Janela que estava em tela cheia (ignorada se não existir mais no projeto).
    fullscreenRef.current = view.fullscreen ?? null;
    setFullscreenId(view.fullscreen ?? null);
    setSelectedId(null);
    setEditingTitleId(null);
    setEditingCommandId(null);
    setFocusNoteId(null);
    setEditingTextId(null);
    setTool("select");
    fitToggle.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao trocar de projeto
  }, [projectKey]);

  // "Ver todas as janelas": visão de antes do enquadramento (para o 2º clique voltar) e a enquadrada.
  const fitToggle = useRef<{ before: CanvasView; fitted: CanvasView } | null>(null);

  // Ao fechar o app/desmontar, salva o que estiver pendente.
  useEffect(() => flushView, [flushView]);

  // Esc sai da ferramenta Terminal.
  useEffect(() => {
    if (tool === "select") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTool("select");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);

  const patchNode = useCallback(
    (id: string, patch: NodePatch) =>
      update((list) => list.map((n) => (n.id === id ? ({ ...n, ...patch } as CanvasNodeData) : n))),
    [update],
  );

  // ---- Agente (Claude Code no terminal) lendo e mexendo no canvas, via ponte MCP ----
  const activity = useAgentActivity(projectKey);
  clearAgentMark.current = activity.clearMark;
  const agentHandler = useRef<(req: AgentRequest) => Promise<void>>(async () => {});
  agentHandler.current = async (req) => {
    const reply = (ok: boolean, result: unknown) =>
      api.agentReply(req.reqId, ok, result ?? null).catch((e) => console.warn(e));
    const isOpen = () => {
      const cur = projectRef.current;
      return !!cur && cur.space === req.space && cur.id === req.projectId;
    };
    if (!isOpen()) {
      reply(false, "O projeto deste agente não está aberto no canvas agora. Peça ao usuário para abri-lo.");
      return;
    }
    const { space, projectId } = req;
    const term = nodesRef.current.find((n) => n.id === req.terminalId && n.type === "terminal");
    const agentName = term && term.type === "terminal" ? term.title : "Agente";
    try {
      const sel = selectionRef.current;
      const list = nodesRef.current;
      const selectedIds = sel.group ? list.filter((n) => n.group === sel.group).map((n) => n.id) : sel.ids;
      const out = await runTool(
        req.tool,
        req.args ?? {},
        { getNodes: () => nodesRef.current, selectedIds, terminalId: req.terminalId },
        {
          importImage: (source) => api.agentImportImage(space, projectId, source),
          attachFile: (source) => api.agentAttachFile(space, projectId, source),
          imageSize: (file) => imageUrl(space, projectId, file).then(imageSize),
          checkDir: (dir) => api.fsList(space, projectId, dir).then(() => undefined),
          confirmDelete: (node) => askAgentDelete(node.id, agentName),
          deleteNode: (node) => deleteNode(node),
          updateBoard: async (boardId, patches) => {
            const ref = { space, projectId, id: boardId };
            const { editElements } = await import("./ExcalidrawBoard");
            const before = await loadScene(ref);
            const { elements, changed, missing } = editElements(before.elements, patches);
            if (changed.length) setScene(ref, { ...before, elements }, { notify: true, immediate: true });
            return { changed, missing, revert: () => setScene(ref, before, { notify: true, immediate: true }) };
          },
          removeFromBoard: async (boardId, ids) => {
            const ref = { space, projectId, id: boardId };
            const { removeElements } = await import("./ExcalidrawBoard");
            const before = await loadScene(ref);
            const { elements, removed, found } = removeElements(before.elements, ids);
            if (found.length) setScene(ref, { ...before, elements }, { notify: true, immediate: true });
            return { removed, found, revert: () => setScene(ref, before, { notify: true, immediate: true }) };
          },
          snapshotBoard: async (boardId) => {
            const ref = { space, projectId, id: boardId };
            const { snapshotPng, describeElements } = await import("./ExcalidrawBoard");
            const scene = await loadScene(ref);
            if (!scene.elements.some((e) => !e.isDeleted)) throw new ToolError("O quadro está vazio.");
            return { png: await snapshotPng(scene), elements: describeElements(scene.elements) };
          },
          drawOnBoard: async (boardId, skeletons, clear, links) => {
            const ref = { space, projectId, id: boardId };
            const { addElements } = await import("./ExcalidrawBoard");
            const before = await loadScene(ref);
            let out;
            try {
              out = addElements(clear ? [] : before.elements, skeletons, links);
            } catch (e) {
              throw new ToolError(e instanceof Error ? e.message : String(e));
            }
            setScene(ref, { ...before, elements: out.elements }, { notify: true, immediate: true });
            return { added: out.added, overlapping: out.overlapping, revert:() => setScene(ref, before, { notify: true, immediate: true }) };
          },
          moveOnBoard: async (boardId, sel, dx, dy) => {
            const ref = { space, projectId, id: boardId };
            const { moveElements } = await import("./ExcalidrawBoard");
            const before = await loadScene(ref);
            const { elements, moved, missing, overlapping } = moveElements(before.elements, sel, dx, dy);
            if (moved.length) setScene(ref, { ...before, elements }, { notify: true, immediate: true });
            return { moved, missing, overlapping, revert:() => setScene(ref, before, { notify: true, immediate: true }) };
          },
          focus: (node) => goToNode(node),
          runScript: (node) => {
            terminals.run(node.id, { space, project: projectId, agent: "script", command: node.command });
            return terminals.scriptState(node.id);
          },
          stopScript: (node) => {
            terminals.stop(node.id);
            return terminals.scriptState(node.id);
          },
          scriptState: (id) => terminals.scriptState(id),
          scriptLines: (id, n) => terminals.readLines(id, n),
        },
      );
      // Trocou de projeto enquanto esperava (importação/confirmação): não aplica no projeto errado.
      if (out.apply) {
        if (!isOpen()) throw new ToolError("O usuário trocou de projeto antes de terminar; nada foi alterado.");
        const apply = out.apply;
        let before: CanvasNodeData[] = [];
        let after: CanvasNodeData[] = [];
        update((current) => {
          before = current;
          after = apply(current);
          return after;
        });
        if (out.log) activity.record(agentName, out.log, { before, after }, out.touched, out.revert);
      } else if (out.log) {
        activity.record(agentName, out.log, undefined, out.touched, out.revert);
      }
      reply(true, out.result);
    } catch (e) {
      reply(false, e instanceof ToolError ? e.message : String(e));
    }
  };

  /** Desfaz a ação mais recente do agente. Devolve false se não havia o que desfazer. */
  const undoAgent = (): boolean => {
    const action = activity.latestUndoable;
    const taken = action && activity.takeUndo(action.id);
    if (!taken) return false;
    if (taken.revert) taken.revert();
    const u = taken.undo;
    if (!u) return true;
    const createdIds = new Set(u.created);
    const prev = new Map(u.prev.map((n) => [n.id, n]));
    let removed: CanvasNodeData[] = [];
    update((list) => {
      removed = list.filter((n) => createdIds.has(n.id));
      // Alteradas voltam como eram (se ainda existirem); criadas saem.
      return normalizeGroups(list.filter((n) => !createdIds.has(n.id)).map((n) => prev.get(n.id) ?? n));
    });
    // Imagens/anexos que o agente trouxe: o arquivo copiado vai para a Lixeira.
    removed.forEach((n) => (n.type === "image" || n.type === "attachment" || n.type === "board") && releaseNode(n));
    if (selectionRef.current.ids.some((id) => createdIds.has(id))) setSelectedId(null);
    return true;
  };
  const undoAgentRef = useRef(undoAgent);
  undoAgentRef.current = undoAgent;

  // Ctrl+Z fora de campos de texto/notas/terminais: desfaz a última ação do agente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
      if (undoAgentRef.current()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Painel "Atividade do agente" (botão 🤖 nos controles de baixo).
  const [activityOpen, setActivityOpen] = useState(false);
  const activityRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activityOpen) return;
    activity.markSeen();
    const onDown = (e: PointerEvent) => {
      if (!activityRef.current?.contains(e.target as Node)) setActivityOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- marca como visto ao abrir e a cada ação nova
  }, [activityOpen, activity.actions.length]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<AgentRequest>("agent-request", (e) => agentHandler.current(e.payload))
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch((e) => console.warn(e));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  /**
   * Alteração vinda de uma janela. Mudança só de posição (arrastar) move junto o grupo
   * conectado e as outras janelas selecionadas; o resto vai direto.
   */
  const changeNode = useCallback(
    (id: string, patch: NodePatch) => {
      // Em tela cheia a janela não se move nem muda de tamanho (o resto da alteração vale).
      if (id === fullscreenRef.current) {
        const { x: _x, y: _y, w: _w, h: _h, ...rest } = patch;
        if (Object.keys(rest).length === 0) return;
        patch = rest;
      }
      const keys = Object.keys(patch);
      const isMove = keys.length === 2 && patch.x !== undefined && patch.y !== undefined;
      if (!isMove) return patchNode(id, patch);
      update((list) => {
        const node = list.find((n) => n.id === id);
        if (!node) return list;
        const dx = patch.x! - node.x;
        const dy = patch.y! - node.y;
        const movers = new Set(groupIds(id, list));
        const sel = selectionRef.current.ids;
        if (sel.includes(id)) for (const s of sel) for (const g of groupIds(s, list)) movers.add(g);
        return list.map((n) => (movers.has(n.id) ? ({ ...n, x: n.x + dx, y: n.y + dy } as CanvasNodeData) : n));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usa refs
    [patchNode, update],
  );

  /** Encerra/apaga o que a janela usa fora do canvas (processo do terminal, arquivo da imagem). */
  const releaseNode = (node: CanvasNodeData) => {
    if (node.type === "terminal" || node.type === "script") terminals.kill(node.id);
    if (node.type === "image" && project) {
      api.deleteCanvasImage(project.space, project.id, node.file).catch((e) => toast.show(String(e)));
    }
    if (node.type === "attachment" && project) {
      api.deleteAttachment(project.space, project.id, node.file).catch((e) => toast.show(String(e)));
    }
    if (node.type === "board" && project) {
      forgetScene({ space: project.space, projectId: project.id, id: node.id });
      api.boardDelete(project.space, project.id, node.id).catch((e) => toast.show(String(e)));
    }
  };

  const deleteNode = (node: CanvasNodeData) => {
    releaseNode(node);
    update((list) => normalizeGroups(list.filter((n) => n.id !== node.id)));
    setSelectedId(null);
    setEditingTitleId(null);
  };

  // ---- Várias selecionadas: conectar / desconectar / excluir ----
  const selectedNodes = () =>
    selection.group
      ? nodes.filter((n) => n.group === selection.group)
      : nodes.filter((n) => selection.ids.includes(n.id));

  const connectSelected = () => {
    const sel = selectedNodes();
    const oldGroups = new Set(sel.map((n) => n.group).filter(Boolean));
    const ids = new Set(sel.map((n) => n.id));
    const group = crypto.randomUUID();
    let members: string[] = [];
    update((list) => {
      const next = list.map((n) =>
        ids.has(n.id) || (n.group && oldGroups.has(n.group)) ? ({ ...n, group } as CanvasNodeData) : n,
      );
      members = next.filter((n) => n.group === group).map((n) => n.id);
      return next;
    });
    setSelection({ ids: members, focus: null, group: null });
  };

  const disconnectSelected = () => {
    const ids = new Set(selectedNodes().map((n) => n.id));
    if (selection.group) setSelection({ ids: [...ids], focus: null, group: null });
    update((list) =>
      normalizeGroups(
        list.map((n) => {
          if (!ids.has(n.id) || !n.group) return n;
          const { group: _drop, ...rest } = n;
          return rest as CanvasNodeData;
        }),
      ),
    );
  };

  /** Exclui as janelas `idList` (encerra terminais, apaga arquivos de imagem/anexo). */
  const deleteIds = (idList: string[]) => {
    const ids = new Set(idList);
    nodesRef.current.filter((n) => ids.has(n.id)).forEach(releaseNode);
    update((list) => normalizeGroups(list.filter((n) => !ids.has(n.id))));
    setSelection(EMPTY_SELECTION);
    setEditingTitleId(null);
  };

  const deleteSelected = () => deleteIds(selectedNodes().map((n) => n.id));

  // ---- Exclusão pedida pelo agente: mesma confirmação da exclusão manual ----
  const [agentDelete, setAgentDelete] = useState<{ id: string; agent: string; answer: (ok: boolean) => void } | null>(
    null,
  );
  const [agentDeleteOpen, setAgentDeleteOpen] = useState(false);
  const agentDeletePresence = usePresence(agentDeleteOpen, 160);

  /** Abre a confirmação e espera a resposta. Sem resposta em ~110 s, cancela (o agente desiste em 120 s). */
  const askAgentDelete = (id: string, agent: string) =>
    new Promise<boolean>((resolve) => {
      let done = false;
      const timer = window.setTimeout(() => answer(false), 110_000);
      const answer = (ok: boolean) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        setAgentDeleteOpen(false);
        resolve(ok);
      };
      // Outro pedido ainda aberto: o anterior conta como cancelado.
      setAgentDelete((prev) => {
        prev?.answer(false);
        return { id, agent, answer };
      });
      setAgentDeleteOpen(true);
    });

  // ---- Tecla Delete: excluir a seleção, com confirmação ----
  const [pendingDelete, setPendingDelete] = useState<string[]>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const confirmDelete = usePresence(confirmDeleteOpen, 160);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" || e.repeat) return;
      // Não em campos de texto/terminal, nem com outro modal aberto.
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable || a.closest(".excalidraw"))) return;
      if (document.querySelector(".st-overlay")) return;
      const { ids, group } = selectionRef.current;
      const list = nodesRef.current;
      const sel = group ? list.filter((n) => n.group === group) : list.filter((n) => ids.includes(n.id));
      if (!sel.length) return;
      e.preventDefault();
      setPendingDelete(sel.map((n) => n.id));
      setConfirmDeleteOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Textos da confirmação: nome da janela (ou quantidade) e o que será encerrado/apagado. */
  const deleteTexts = (idList: string[]) => {
    const sel = nodes.filter((n) => idList.includes(n.id));
    const label = (n: CanvasNodeData) =>
      "title" in n && n.title
        ? n.title
        : { text: "Texto", image: "Imagem", folder: "Pasta", portal: "Portal", attachment: "Anexo" }[
            n.type as "text" | "image" | "folder" | "portal" | "attachment"
          ] ?? "Janela";
    const effects: string[] = [];
    if (sel.some((n) => n.type === "terminal" || n.type === "script")) effects.push("o processo do terminal será encerrado");
    if (sel.some((n) => n.type === "image" || n.type === "attachment")) effects.push("os arquivos de imagem/anexo serão apagados");
    const extra = effects.length ? ` Além disso, ${effects.join(" e ")}.` : "";
    return {
      name: sel.length === 1 ? label(sel[0]) : `${sel.length} janelas`,
      title: sel.length === 1 ? `Excluir “${label(sel[0])}”?` : `Excluir ${sel.length} janelas?`,
      message: `Esta ação não pode ser desfeita.${extra}`,
    };
  };

  const multiActions = (): NodeAction[][] => {
    const sel = selectedNodes();
    const groups = new Set(sel.map((n) => n.group).filter(Boolean));
    const allConnected = groups.size === 1 && sel.every((n) => n.group);
    const connect: NodeAction[] = [];
    if (!allConnected) connect.push({ icon: Link2, label: "Conectar (movem juntas)", onClick: connectSelected });
    if (groups.size > 0) connect.push({ icon: Unlink2, label: "Desconectar", onClick: disconnectSelected });
    return [
      [{ label: "Seleção", display: true, content: `${sel.length} ${allConnected ? "conectadas" : "selecionadas"}` }],
      connect,
      [{ icon: Trash2, label: "Excluir selecionadas", onClick: deleteSelected }],
    ].filter((g) => g.length > 0);
  };

  // ---- Seleção por arraste (retângulo) e mover o canvas ----
  const [marquee, setMarquee] = useState<ScreenRect | null>(null);
  const spaceHeld = useRef(false);
  const [spacePan, setSpacePan] = useState(false);

  // Espaço segurado (fora de campos de texto/terminal): arrastar move o canvas.
  useEffect(() => {
    const typing = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable || !!a.closest(".excalidraw"));
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing()) return;
      e.preventDefault();
      if (!spaceHeld.current) {
        spaceHeld.current = true;
        setSpacePan(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceHeld.current = false;
      setSpacePan(false);
    };
    const reset = () => {
      spaceHeld.current = false;
      setSpacePan(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);

  /** Arrastar no fundo com Selecionar: desenha o retângulo e seleciona o que ele toca. */
  const startMarquee = (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const box = (pan.ref.current ?? el).getBoundingClientRect();
    const sx = e.clientX - box.left;
    const sy = e.clientY - box.top;
    el.setPointerCapture(e.pointerId);
    let rect: ScreenRect | null = null;

    const move = (ev: PointerEvent) => {
      const x = ev.clientX - box.left;
      const y = ev.clientY - box.top;
      if (!rect && Math.hypot(x - sx, y - sy) < DRAW_CLICK_THRESHOLD) return;
      rect = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) };
      setMarquee(rect);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setMarquee(null);
      if (!rect) return; // foi só um clique: a seleção já foi limpa
      const w = toWorld(rect);
      const hit = nodesRef.current.filter(
        (n) => n.x < w.x + w.w && n.x + n.w > w.x && n.y < w.y + w.h && n.y + n.h > w.y,
      );
      const ids = new Set<string>();
      for (const n of hit) for (const g of groupIds(n.id)) ids.add(g);
      const list = [...ids];
      setSelection({ ids: list, focus: list.length === 1 ? list[0] : null, group: null });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  // ---- Imagens: colar (Ctrl+V) e arrastar do Explorer ----
  const toast = useToast();
  /** Última posição do mouse sobre o canvas (coordenadas da janela). */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const [dropActive, setDropActive] = useState(false);

  /** Ponto da janela → ponto do canvas (ou o centro, se estiver fora dele). */
  const canvasPoint = (client: { x: number; y: number } | null) => {
    const box = pan.ref.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    const inside =
      client && client.x >= box.left && client.x <= box.right && client.y >= box.top && client.y <= box.bottom;
    return inside ? { x: client.x - box.left, y: client.y - box.top } : { x: box.width / 2, y: box.height / 2 };
  };

  /** Cria cards para imagens já gravadas no projeto, centradas em `at` (em cascata se forem várias). */
  const addImages = async (p: ActiveProject, files: string[], at: { x: number; y: number }) => {
    const created: ImageNodeData[] = [];
    for (const [i, file] of files.entries()) {
      try {
        const size = await imageSize(await imageUrl(p.space, p.id, file));
        const scale = Math.min(1, IMAGE_INITIAL_MAX / Math.max(size.w, size.h));
        const w = size.w * scale;
        const h = size.h * scale;
        const v = pan.getView();
        created.push({
          id: crypto.randomUUID(),
          type: "image",
          file,
          x: (at.x - v.x) / v.zoom - w / 2 + i * 24,
          y: (at.y - v.y) / v.zoom - h / 2 + i * 24,
          w,
          h,
        });
      } catch (e) {
        toast.show(String(e));
      }
    }
    // Trocou de projeto enquanto carregava: não coloca no projeto errado.
    const cur = projectRef.current;
    if (!created.length || !cur || cur.space !== p.space || cur.id !== p.id) return;
    update((list) => [...list, ...created]);
    setSelectedId(created[created.length - 1].id);
  };

  /** Cria cards de anexo (arquivos já copiados para o projeto), centrados em `at`, em cascata. */
  const addAttachments = (p: ActiveProject, list: Attached[], at: { x: number; y: number }, offset = 0) => {
    const cur = projectRef.current;
    if (!list.length || !cur || cur.space !== p.space || cur.id !== p.id) return;
    const v = pan.getView();
    const created: AttachmentNodeData[] = list.map((a, i) => {
      const { w, h } = attachmentSize(attachmentKind(a.name));
      const k = i + offset;
      return {
        id: crypto.randomUUID(),
        type: "attachment",
        file: a.file,
        name: a.name,
        size: a.size,
        x: (at.x - v.x) / v.zoom - w / 2 + k * 24,
        y: (at.y - v.y) / v.zoom - h / 2 + k * 24,
        w,
        h,
      };
    });
    update((nodesList) => [...nodesList, ...created]);
    setSelectedId(created[created.length - 1].id);
  };

  /** Arquivos do disco (seletor ou Explorer): imagens viram card de Imagem; o resto, Anexo. */
  const addPaths = (p: ActiveProject, paths: string[], at: { x: number; y: number }) => {
    const images = paths.filter((path) => IMAGE_FILE_EXT.test(path));
    const others = paths.filter((path) => !IMAGE_FILE_EXT.test(path));
    if (images.length) {
      api
        .importCanvasImages(p.space, p.id, images)
        .then((names) => addImages(p, names, at))
        .catch((err) => toast.show(String(err)));
    }
    if (others.length) {
      api
        .importAttachments(p.space, p.id, others)
        .then((list) => addAttachments(p, list, at, images.length))
        .catch((err) => toast.show(String(err)));
    }
  };

  /** 📎 Anexo: escolhe arquivos no seletor do Windows e coloca no centro da tela. */
  const pickAttachments = async () => {
    const p = projectRef.current;
    if (!p) return;
    const picked = await openFileDialog({ multiple: true, directory: false, title: "Anexar arquivos" });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length) addPaths(p, paths, canvasPoint(null));
  };

  // Ctrl+V com arquivos na área de transferência (fora de campos de texto e terminais):
  // imagens viram card de Imagem; outros arquivos, Anexo (até 200 MB).
  useEffect(() => {
    const MAX = 200 * 1024 * 1024;
    const onPaste = (e: ClipboardEvent) => {
      const p = projectRef.current;
      if (!p) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable || active.closest(".excalidraw"))) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) {
        // Só texto: vira texto solto (linha curta) ou nota.
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (!text.trim()) return;
        e.preventDefault();
        addPastedText(text, canvasPoint(lastPointer.current));
        return;
      }
      e.preventDefault();
      const at = canvasPoint(lastPointer.current);
      files.forEach((file, i) => {
        if (file.size > MAX) {
          toast.show(`"${file.name}" é grande demais (máximo 200 MB).`);
          return;
        }
        const bytes = file.arrayBuffer().then((buf) => new Uint8Array(buf));
        const spot = { x: at.x + i * 24, y: at.y + i * 24 };
        if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
          bytes
            .then((b) => api.saveCanvasImage(p.space, p.id, b, file.name))
            .then((name) => addImages(p, [name], spot))
            .catch((err) => toast.show(String(err)));
        } else {
          bytes
            .then((b) => api.saveAttachment(p.space, p.id, file.name || "arquivo", b))
            .then((a) => addAttachments(p, [a], spot))
            .catch((err) => toast.show(String(err)));
        }
      });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usa refs
  }, []);

  // Arquivos arrastados do Explorer para a janela (imagens → Imagem; o resto → Anexo).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const ev = event.payload;
        if (ev.type === "enter") {
          setDropActive(!!projectRef.current && ev.paths.length > 0);
        } else if (ev.type === "leave") {
          setDropActive(false);
        } else if (ev.type === "drop") {
          setDropActive(false);
          const p = projectRef.current;
          if (!p || !ev.paths.length) return;
          // Posição vem em pixels físicos.
          const dpr = window.devicePixelRatio || 1;
          const at = canvasPoint({ x: ev.position.x / dpr, y: ev.position.y / dpr });
          addPaths(p, ev.paths, at);
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usa refs
  }, []);

  // ---- Texto solto (ferramenta Texto) ----
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  /** Cria um texto no ponto clicado (coordenadas do canvas), já em edição. */
  const createText = (at: { x: number; y: number }) => {
    const v = pan.getView();
    const node: TextNodeData = {
      id: crypto.randomUUID(),
      type: "text",
      text: "",
      ...TEXT_DEFAULTS,
      // O clique fica mais ou menos no meio da primeira linha.
      x: (at.x - v.x) / v.zoom - 12,
      y: (at.y - v.y) / v.zoom - TEXT_DEFAULTS.size * 0.75,
      w: 0,
      h: 0,
    };
    update((list) => [...list, node]);
    setSelectedId(node.id);
    setEditingTextId(node.id);
  };

  /**
   * Texto colado no canvas (Ctrl+V), no ponto `at` (coordenadas do canvas).
   * Uma linha curta vira texto solto; o resto, nota (centrada no ponto). Fica selecionado, sem editar.
   */
  const addPastedText = (raw: string, at: { x: number; y: number }) => {
    const text = raw.replace(/\r\n?/g, "\n").trim();
    if (!text) return;
    const v = pan.getView();
    const wx = (at.x - v.x) / v.zoom;
    const wy = (at.y - v.y) / v.zoom;
    const node: CanvasNodeData =
      !text.includes("\n") && text.length <= PASTE_TEXT_MAX
        ? {
            id: crypto.randomUUID(),
            type: "text",
            ...TEXT_DEFAULTS,
            text,
            x: wx - 12,
            y: wy - TEXT_DEFAULTS.size * 0.75,
            w: 0,
            h: 0,
          }
        : {
            id: crypto.randomUUID(),
            type: "note",
            ...NOTE_DEFAULTS,
            text,
            color: getLastNoteColor(),
            x: wx - NOTE_DEFAULT_W / 2,
            y: wy - NOTE_DEFAULT_H / 2,
            w: NOTE_DEFAULT_W,
            h: NOTE_DEFAULT_H,
          };
    update((list) => [...list, node]);
    setSelectedId(node.id);
  };

  /** Fim da edição: texto vazio é removido. */
  const endTextEdit = (id: string) => {
    setEditingTextId((cur) => (cur === id ? null : cur));
    update((list) => list.filter((n) => !(n.id === id && n.type === "text" && !n.text.trim())));
  };

  // Nota recém-criada: recebe o foco para digitar.
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);

  // ---- Desenhar um terminal novo (ferramenta Terminal) ----
  const [draft, setDraft] = useState<ScreenRect | null>(null);
  const [createMenu, setCreateMenu] = useState<{ x: number; y: number; rect: ScreenRect } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const createPresence = usePresence(createOpen, 110);

  const toWorld = (r: ScreenRect) => {
    const v = pan.getView();
    return { x: (r.x - v.x) / v.zoom, y: (r.y - v.y) / v.zoom, w: r.w / v.zoom, h: r.h / v.zoom };
  };

  const startDraw = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const box = (pan.ref.current ?? el).getBoundingClientRect();
    const sx = e.clientX - box.left;
    const sy = e.clientY - box.top;
    el.setPointerCapture(e.pointerId);
    let moved = false;

    const move = (ev: PointerEvent) => {
      const x = ev.clientX - box.left;
      const y = ev.clientY - box.top;
      if (!moved && Math.hypot(x - sx, y - sy) < DRAW_CLICK_THRESHOLD) return;
      moved = true;
      setDraft({ x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      const zoom = pan.getView().zoom;
      const x = ev.clientX - box.left;
      const y = ev.clientY - box.top;
      const isNote = tool === "note";
      const isFolder = tool === "folder";
      const isPortal = tool === "portal";
      const isBoard = tool === "draw";
      const isScript = tool === "script";
      // Script nasce expandido (com o campo do comando).
      const min = isScript
        ? { w: minSize("script").w, h: SCRIPT_MIN_OPEN_H }
        : minSize(isNote ? "note" : isFolder ? "folder" : isPortal ? "portal" : isBoard ? "board" : "terminal");
      const def = isScript
        ? { w: SCRIPT_DEFAULT_W, h: SCRIPT_DEFAULT_OPEN_H }
        : isNote
        ? { w: NOTE_DEFAULT_W, h: NOTE_DEFAULT_H }
        : isFolder
          ? { w: FOLDER_DEFAULT_W, h: FOLDER_DEFAULT_H }
          : isPortal
            ? { w: PORTAL_DEFAULT_W, h: PORTAL_DEFAULT_H }
            : isBoard
              ? { w: BOARD_DEFAULT_W, h: BOARD_DEFAULT_H }
              : { w: NODE_DEFAULT_W, h: NODE_DEFAULT_H };
      // Clique sem arrastar → tamanho padrão a partir do ponto; arrastado → respeita o mínimo.
      const rect: ScreenRect = moved
        ? {
            x: Math.min(sx, x),
            y: Math.min(sy, y),
            w: Math.max(Math.abs(x - sx), min.w * zoom),
            h: Math.max(Math.abs(y - sy), min.h * zoom),
          }
        : { x: sx, y: sy, w: def.w * zoom, h: def.h * zoom };

      if (isNote) {
        // Nota: cria direto, já pronta para digitar.
        setDraft(null);
        createNote(rect);
        setTool("select");
        return;
      }
      if (isPortal) {
        // Portal: cria direto, com a barra de endereço focada.
        setDraft(null);
        createPortal(rect);
        setTool("select");
        return;
      }
      if (isFolder) {
        // Pasta: cria direto, na raiz do projeto.
        setDraft(null);
        createFolder(rect);
        setTool("select");
        return;
      }
      if (isScript) {
        // Script: cria direto, com o campo do comando aberto.
        setDraft(null);
        createScript(rect);
        setTool("select");
        return;
      }
      if (isBoard) {
        // Quadro: cria direto, já selecionado (pronto para desenhar).
        setDraft(null);
        createBoard(rect);
        setTool("select");
        return;
      }
      setDraft(rect);
      setCreateMenu({ x: ev.clientX, y: ev.clientY, rect });
      setCreateOpen(true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const createTerminal = (agent: AgentKind, rect: ScreenRect) => {
    const w = toWorld(rect);
    const node: TerminalNodeData = {
      id: crypto.randomUUID(),
      type: "terminal",
      agent,
      title: AGENTS[agent].title,
      fontSize: TERM_FONT_DEFAULT,
      x: w.x,
      y: w.y,
      w: Math.max(NODE_MIN_W, w.w),
      h: Math.max(NODE_MIN_H, w.h),
    };
    update((list) => [...list, node]);
    setSelectedId(node.id);
  };

  const createScript = (rect: ScreenRect) => {
    const w = toWorld(rect);
    const openH = Math.max(SCRIPT_MIN_OPEN_H, w.h);
    const node: ScriptNodeData = {
      id: crypto.randomUUID(),
      type: "script",
      title: SCRIPT_DEFAULT_TITLE,
      command: "",
      approved: true,
      expanded: true,
      openH,
      x: w.x,
      y: w.y,
      w: Math.max(minSize("script").w, w.w),
      h: openH,
    };
    update((list) => [...list, node]);
    setSelectedId(node.id);
    setEditingCommandId(node.id);
  };

  // ---- Script: executar, parar, aprovar, expandir, editar o comando ----
  const scriptTarget = (n: ScriptNodeData) =>
    project ? { space: project.space, project: project.id, agent: "script" as const, command: n.command } : null;

  const expandPatch = (n: ScriptNodeData): NodePatch =>
    n.expanded ? {} : { expanded: true, h: Math.max(SCRIPT_MIN_OPEN_H, n.openH) };

  const scriptAction = (id: string, action: ScriptAction) => {
    const n = nodesRef.current.find((m): m is ScriptNodeData => m.id === id && m.type === "script");
    if (!n) return;
    switch (action) {
      case "run": {
        if (!n.command.trim()) {
          patchNode(id, expandPatch(n));
          setEditingCommandId(id);
          return;
        }
        if (!n.approved) {
          patchNode(id, expandPatch(n)); // mostra o pedido de aprovação
          return;
        }
        const target = scriptTarget(n);
        if (target) terminals.run(id, target);
        return;
      }
      case "approve": {
        patchNode(id, { approved: true, ...expandPatch(n) });
        const target = scriptTarget(n);
        if (target && n.command.trim()) terminals.run(id, target);
        return;
      }
      case "stop":
        terminals.stop(id);
        return;
      case "expand":
        patchNode(id, expandPatch(n));
        return;
      case "collapse":
        if (editingCommandId === id) setEditingCommandId(null);
        patchNode(id, { expanded: false, openH: n.h, h: SCRIPT_COLLAPSED_H });
        return;
      case "edit":
        patchNode(id, expandPatch(n));
        setEditingCommandId(id);
        return;
    }
  };

  /** Fim da edição do comando: o que o usuário salva já fica aprovado. */
  const finishCommand = (id: string, command: string | null) => {
    setEditingCommandId(null);
    if (command === null) return;
    patchNode(id, { command: command.trim(), approved: true });
  };

  const createPortal = (rect: ScreenRect) => {
    const w = toWorld(rect);
    const node: PortalNodeData = {
      id: crypto.randomUUID(),
      type: "portal",
      url: "",
      x: w.x,
      y: w.y,
      w: Math.max(minSize("portal").w, w.w),
      h: Math.max(minSize("portal").h, w.h),
    };
    update((list) => [...list, node]);
    setSelectedId(node.id);
    setFocusNoteId(node.id); // reaproveita o "foco ao criar"
  };

  const createBoard = (rect: ScreenRect) => {
    const w = toWorld(rect);
    const node: BoardNodeData = {
      id: crypto.randomUUID(),
      type: "board",
      title: BOARD_DEFAULT_TITLE,
      x: w.x,
      y: w.y,
      w: Math.max(minSize("board").w, w.w),
      h: Math.max(minSize("board").h, w.h),
    };
    update((list) => [...list, node]);
    setSelectedId(node.id);
  };

  const createFolder = (rect: ScreenRect) => {
    const w = toWorld(rect);
    const node: FolderNodeData = {
      id: crypto.randomUUID(),
      type: "folder",
      ...FOLDER_DEFAULTS,
      x: w.x,
      y: w.y,
      w: Math.max(minSize("folder").w, w.w),
      h: Math.max(minSize("folder").h, w.h),
    };
    update((list) => [...list, node]);
    setSelectedId(node.id);
  };

  const createNote = (rect: ScreenRect) => {
    const w = toWorld(rect);
    const node: NoteNodeData = {
      id: crypto.randomUUID(),
      type: "note",
      text: "",
      ...NOTE_DEFAULTS,
      color: getLastNoteColor(),
      x: w.x,
      y: w.y,
      w: Math.max(NOTE_MIN_W, w.w),
      h: Math.max(NOTE_MIN_H, w.h),
    };
    update((list) => [...list, node]);
    setSelectedId(node.id);
    setFocusNoteId(node.id);
  };

  const closeCreateMenu = useCallback(() => {
    setCreateOpen(false);
    setDraft(null);
    setTool("select");
  }, []);

  const createItems = (rect: ScreenRect): ContextMenuItem[] => [
    { label: "Terminal (PowerShell)", icon: SquareTerminal, onSelect: () => createTerminal("shell", rect) },
    { label: "Claude Code", icon: CircleDot, onSelect: () => createTerminal("claude", rect) },
    { label: "Codex", icon: Bot, onSelect: () => createTerminal("codex", rect) },
  ];

  // ---- Formatação das notas ----
  const formatNote = (note: NoteNodeData, kind: FormatKind) => {
    const r = applyFormat(note.id, kind, note.text);
    if (!r) return;
    patchNode(note.id, { text: r.text });
    restoreSelection(note.id, r.start, r.end);
  };

  // Painéis da barra da nota (cor, tamanho, fonte, título).
  const [popover, setPopover] = useState<{ kind: PopoverKind; noteId: string; x: number; y: number } | null>(
    null,
  );
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverPresence = usePresence(popoverOpen, 110);
  const closePopover = useCallback(() => setPopoverOpen(false), []);

  /** Abre o painel abaixo do botão; clicar no mesmo botão de novo fecha. */
  const togglePopover = (kind: PopoverKind, noteId: string, button: HTMLElement) => {
    if (popoverOpen && popover?.kind === kind && popover.noteId === noteId) {
      setPopoverOpen(false);
      return;
    }
    const r = button.getBoundingClientRect();
    setPopover({ kind, noteId, x: r.left - 8, y: r.bottom + 8 });
    setPopoverOpen(true);
  };

  // Trocou/limpou a seleção: fecha o painel.
  useEffect(() => setPopoverOpen(false), [selectedId]);

  /** Fim da edição do nome de um card (terminal ou nota). Vazio/cancelado mantém o nome. */
  const finishTitle = (id: string, title: string | null) => {
    setEditingTitleId(null);
    const clean = title?.trim();
    if (clean) patchNode(id, { title: clean });
  };

  const noteActions = (note: NoteNodeData): NodeAction[][] => [
    [{ icon: SquarePen, label: "Renomear", onClick: () => setEditingTitleId(note.id) }],
    [{ icon: Palette, label: "Cor", popover: "color" }],
    [
      { icon: AArrowUp, label: `Tamanho da fonte (${note.fontSize})`, popover: "size" },
      { icon: CaseSensitive, label: `Fonte: ${note.font || "Padrão (monoespaçada)"}`, popover: "font" },
    ],
    [
      { icon: Bold, label: "Negrito", onClick: () => formatNote(note, "bold") },
      { icon: Italic, label: "Itálico", onClick: () => formatNote(note, "italic") },
      { icon: Strikethrough, label: "Riscado", onClick: () => formatNote(note, "strike") },
      { icon: Code, label: "Código", onClick: () => formatNote(note, "code") },
      { icon: Hash, label: "Título", popover: "heading" },
    ],
    [
      { icon: ListChecks, label: "Lista de tarefas", onClick: () => formatNote(note, "checklist") },
      { icon: List, label: "Lista", onClick: () => formatNote(note, "list") },
      { icon: Braces, label: "Bloco de código", onClick: () => formatNote(note, "codeblock") },
      { icon: Image, label: "Imagem" },
      {
        icon: MarkdownIcon,
        label: note.preview ? "Ocultar preview" : "Preview ao lado (Markdown)",
        active: note.preview,
        onClick: () => patchNode(note.id, { preview: !note.preview }),
      },
      { icon: Ellipsis, label: "Mais" },
    ],
    [{ icon: GitBranch, label: "Git" }],
    [{ icon: Trash2, label: "Excluir", onClick: () => deleteNode(note) }],
  ];

  /**
   * Mudar o tamanho do texto mantendo o centro parado. Mede o texto agora e devolve
   * uma função que aplica cada novo tamanho a partir dessa medida (serve para o arraste).
   */
  const centeredTextResize = (t: TextNodeData) => {
    const el = document.querySelector<HTMLElement>(`.text-node[data-node-id="${t.id}"]`);
    const zoom = pan.getView().zoom;
    // Espaçamento interno do card (em unidades do mundo; não muda com o tamanho da fonte).
    const PAD_X = 14;
    const PAD_Y = 4;
    const w0 = el ? el.offsetWidth / zoom : 0;
    const h0 = el ? el.offsetHeight / zoom : 0;
    return (raw: number) => {
      const size = Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, raw));
      if (!el) return patchNode(t.id, { size });
      const r = size / t.size;
      const w = (w0 - 2 * PAD_X) * r + 2 * PAD_X;
      const h = (h0 - 2 * PAD_Y) * r + 2 * PAD_Y;
      patchNode(t.id, { size, x: t.x - (w - w0) / 2, y: t.y - (h - h0) / 2 });
    };
  };

  const textActions = (t: TextNodeData): NodeAction[][] => {
    const setSize = (size: number) => centeredTextResize(t)(size);
    return [
      [
        { icon: Minus, label: "Diminuir", onClick: () => setSize(t.size - TEXT_SIZE_STEP) },
        {
          label: "Tamanho (arraste para os lados)",
          display: true,
          content: t.size,
          onScrub: (e) =>
            scrubNumber(e, t.size, centeredTextResize(t), {
              min: TEXT_SIZE_MIN,
              max: TEXT_SIZE_MAX,
              pxPerUnit: 2,
            }),
        },
        { icon: Plus, label: "Aumentar", onClick: () => setSize(t.size + TEXT_SIZE_STEP) },
      ],
      (Object.keys(TEXT_WEIGHTS) as TextWeight[]).map((w) => ({
        label: TEXT_WEIGHTS[w].label,
        content: <span style={{ fontWeight: TEXT_WEIGHTS[w].css }}>{TEXT_WEIGHTS[w].short}</span>,
        active: t.weight === w,
        onClick: () => patchNode(t.id, { weight: w }),
      })),
      (Object.keys(TEXT_FAMILIES) as TextFamily[]).map((f) => ({
        label: `Fonte ${TEXT_FAMILIES[f].label}`,
        content: <span style={{ fontFamily: TEXT_FAMILIES[f].css }}>{TEXT_FAMILIES[f].label}</span>,
        active: t.family === f,
        onClick: () => patchNode(t.id, { family: f }),
      })),
      [
        {
          label: "Cor",
          content: <span className="tool-color-dot" style={{ background: t.color }} />,
          popover: "textColor",
        },
      ],
      [{ icon: Trash2, label: "Excluir", onClick: () => deleteNode(t) }],
    ];
  };

  // ---- Lista das janelas (canto superior direito; recolhida até clicar) ----
  const [windowsOpen, setWindowsOpen] = useState(false);
  const windowsRef = useRef<HTMLDivElement>(null);

  // Lista aberta: clicar fora dela recolhe. Usa pointerdown na captura porque o canvas
  // e os cards cancelam o mousedown ao arrastar.
  useEffect(() => {
    if (!windowsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!windowsRef.current?.contains(e.target as Node)) setWindowsOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [windowsOpen]);
  /** Nome mostrado na lista para cada janela. */
  const windowLabel = (n: CanvasNodeData) => {
    if (n.type === "terminal" || n.type === "note" || n.type === "script") return n.title;
    if (n.type === "image") return "Imagem";
    if (n.type === "attachment") return n.name;
    if (n.type === "portal") {
      try {
        return n.url ? new URL(n.url).host : "Portal";
      } catch {
        return "Portal";
      }
    }
    if (n.type === "folder") return n.dir ? (n.dir.split("/").pop() ?? n.dir) : (project?.name ?? "Pasta");
    if (n.type === "board") return n.title;
    const line = n.text.split("\n").find((l) => l.trim()) ?? "";
    return line.trim().slice(0, 60) || "Texto";
  };

  const windowIcon = (n: CanvasNodeData) => {
    if (n.type === "terminal") {
      const color = AGENTS[n.agent].color;
      return n.agent === "shell" ? <SquareTerminal size={14} color={color} /> : <CircleDot size={14} color={color} />;
    }
    if (n.type === "note") return <Scroll size={14} />;
    if (n.type === "script") return <SquareCode size={14} />;
    if (n.type === "image") return <Image size={14} />;
    if (n.type === "attachment") return <Paperclip size={14} />;
    if (n.type === "portal") return <Globe size={14} />;
    if (n.type === "folder") return <Folder size={14} />;
    if (n.type === "board") return <PenTool size={14} />;
    return <Type size={14} />;
  };

  /**
   * Minimapa: enquadra todas as janelas na tela (centralizadas, zoom para caber, no máx. 100%).
   * Clicar de novo, sem ter mexido na visão, volta para onde estava antes.
   */
  const fitAll = () => {
    const now = pan.getView();
    const prev = fitToggle.current;
    const same = (a: CanvasView, b: CanvasView) =>
      Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.zoom - b.zoom) < 0.001;
    if (prev && same(now, prev.fitted)) {
      fitToggle.current = null;
      pan.goTo(prev.before);
      return;
    }
    const list = nodesRef.current;
    if (!list.length) return;
    const x1 = Math.min(...list.map((n) => n.x));
    const y1 = Math.min(...list.map((n) => n.y));
    const x2 = Math.max(...list.map((n) => n.x + n.w));
    const y2 = Math.max(...list.map((n) => n.y + n.h));
    pan.centerOn({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    fitToggle.current = { before: now, fitted: pan.getView() };
  };

  /** Seleciona a janela e leva a visualização até ela, centralizada. */
  // ---- Tela cheia de uma janela ----
  /** Janela em tela cheia, se ainda existir no projeto (texto solto não entra). */
  const fsNode = fullscreenId ? (nodes.find((n) => n.id === fullscreenId && canFullscreen(n)) ?? null) : null;

  /** Entra/sai da tela cheia e salva junto com a visão do projeto. */
  const setFullscreen = (id: string | null) => {
    fullscreenRef.current = id;
    setFullscreenId(id);
    if (id) {
      setSelectedId(id);
      // Solta o foco da janela anterior (senão o teclado iria para uma janela escondida);
      // terminal já recebe o foco.
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (nodesRef.current.find((n) => n.id === id)?.type === "terminal") {
        window.setTimeout(() => terminals.focus(id), 0);
      }
    }
    queueViewSave(pan.getView());
  };

  const toggleFullscreen = (id: string) => setFullscreen(fullscreenRef.current === id ? null : id);

  // Atalhos (em captura: passam na frente do terminal e do Excalidraw):
  // Ctrl+Shift+F entra/sai da tela cheia da janela selecionada; Ctrl+Tab / Ctrl+Shift+Tab trocam.
  const setFullscreenRef = useRef(setFullscreen);
  setFullscreenRef.current = setFullscreen;

  /** Janelas que podem ir para tela cheia (ordem da lista) e a que está agora (se houver). */
  const fullscreenState = () => {
    const list = nodesRef.current.filter(canFullscreen);
    const active = list.some((n) => n.id === fullscreenRef.current) ? fullscreenRef.current : null;
    return { list, active };
  };

  /** Em tela cheia: vai para a próxima (1) ou anterior (-1) janela. false se não há para onde ir. */
  const cycleFullscreen = (dir: 1 | -1) => {
    const { list, active } = fullscreenState();
    if (!active || list.length < 2) return false;
    const i = list.findIndex((n) => n.id === active);
    setFullscreenRef.current(list[(i + dir + list.length) % list.length].id);
    // Desliza (como trocar de espaço no macOS), a menos que o sistema peça menos animação.
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setFsLeaving({ id: active, dir });
    return true;
  };

  // Animação da troca: a nova janela entra por um lado enquanto a antiga sai pelo outro.
  useLayoutEffect(() => {
    if (!fsLeaving) return;
    const root = pan.ref.current;
    const find = (id: string | null) =>
      id ? root?.querySelector<HTMLElement>(`.canvas-node[data-node-id="${CSS.escape(id)}"]`) : null;
    const leaving = find(fsLeaving.id);
    const entering = find(fullscreenRef.current);
    if (!leaving || !entering || leaving === entering) {
      setFsLeaving(null);
      return;
    }
    const d = fsLeaving.dir;
    const timing: KeyframeAnimationOptions = {
      duration: FS_SWITCH_MS,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards",
    };
    const anims = [
      entering.animate([{ transform: `translateX(${d * 100}%)` }, { transform: "translateX(0)" }], timing),
      leaving.animate(
        [
          { transform: "translateX(0)", filter: "brightness(1)" },
          { transform: `translateX(${-d * 100}%)`, filter: "brightness(0.55)" },
        ],
        timing,
      ),
    ];
    const done = fsLeaving;
    anims[0].finished.then(() => setFsLeaving((cur) => (cur === done ? null : cur))).catch(() => undefined);
    // Troca nova no meio (ou fim): cancela esta; a janela que saiu já está escondida.
    return () => anims.forEach((a) => a.cancel());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando começa uma troca
  }, [fsLeaving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || document.querySelector(".st-overlay")) return;
      const { list, active } = fullscreenState();
      if (e.shiftKey && e.code === "KeyF") {
        const target = active ? null : selectionRef.current.focus;
        if (!active && !list.some((n) => n.id === target)) return;
        e.preventDefault();
        e.stopPropagation();
        setFullscreenRef.current(target);
        return;
      }
      if (e.key === "Tab" && active && list.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        cycleFullscreen(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usa refs
  }, []);

  // Alt + roda (em tela cheia): troca de janela — para baixo = próxima, para cima = anterior.
  // Uma troca por "clique" da roda (ou gesto do touchpad) e uma pausa curta, para um giro
  // rápido não pular várias. Em captura: passa na frente do terminal/Excalidraw.
  useEffect(() => {
    const STEP = 80; // px de roda acumulados para trocar (1 clique ≈ 100)
    const COOLDOWN_MS = 350;
    const IDLE_MS = 250; // parou de girar: zera o acumulado
    let acc = 0;
    let last = 0;
    let blockedUntil = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const { list, active } = fullscreenState();
      if (!active || list.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - last > IDLE_MS) acc = 0;
      last = now;
      if (now < blockedUntil) return;
      acc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (Math.abs(acc) < STEP) return;
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      blockedUntil = now + COOLDOWN_MS;
      cycleFullscreen(dir);
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usa refs
  }, []);

  // Tamanho da área do canvas (a janela em tela cheia ocupa isso, via CSS).
  useEffect(() => {
    const el = pan.ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      el.style.setProperty("--fs-w", String(el.clientWidth));
      el.style.setProperty("--fs-h", String(el.clientHeight));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o elemento do canvas não muda
  }, []);

  const goToNode = (n: CanvasNodeData) => {
    setSelectedId(n.id);
    let { w, h } = n;
    if (n.type === "text") {
      // O texto não guarda o tamanho: mede o que está na tela.
      const el = document.querySelector<HTMLElement>(`.text-node[data-node-id="${n.id}"]`);
      const zoom = pan.getView().zoom;
      w = el ? el.offsetWidth / zoom : 0;
      h = el ? el.offsetHeight / zoom : 0;
    }
    pan.centerOn({ x: n.x, y: n.y, w, h });
  };

  // ---- Clique no fundo do canvas ----
  const onCanvasPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const onBackground = target === e.currentTarget || target.classList.contains("canvas-world");
    if (!onBackground) return;
    backgroundPointerDown(e);
  };

  /** Clique/arraste no fundo (ou no retângulo de um grupo com outra ferramenta/Espaço/botão do meio). */
  const backgroundPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    // Botão do meio ou Espaço + arrastar: move o canvas (com qualquer ferramenta).
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      e.preventDefault();
      pan.onPointerDown(e);
      return;
    }
    if (DRAW_TOOLS.includes(tool) && project) {
      startDraw(e);
      return;
    }
    if (tool === "text" && project && e.button === 0) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      const box = (pan.ref.current ?? e.currentTarget).getBoundingClientRect();
      createText({ x: e.clientX - box.left, y: e.clientY - box.top });
      setTool("select");
      return;
    }
    if (e.button !== 0) return;
    setSelectedId(null);
    setEditingTitleId(null);
    // Tira o foco de notas/terminais (assim o Ctrl+V seguinte cola no canvas).
    (document.activeElement as HTMLElement | null)?.blur?.();
    startMarquee(e);
  };

  /** Clique no retângulo do grupo: seleciona o grupo e arrasta todas as janelas dele. */
  const startGroupMove = (e: React.PointerEvent<HTMLElement>, group: string) => {
    if (e.button !== 0 || tool !== "select" || spaceHeld.current) {
      backgroundPointerDown(e); // outra ferramenta, Espaço ou botão do meio: age como o fundo
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur?.();
    setEditingTitleId(null);
    setSelection({ ids: [], focus: null, group });
    const start = new Map(
      nodesRef.current.filter((n) => n.group === group).map((n) => [n.id, { x: n.x, y: n.y }]),
    );
    const zoom = pan.getView().zoom;
    dragPointer(e, (dx, dy) =>
      update((list) =>
        list.map((n) => {
          const s0 = start.get(n.id);
          return s0 ? ({ ...n, x: s0.x + dx / zoom, y: s0.y + dy / zoom } as CanvasNodeData) : n;
        }),
      ),
    );
  };

  /**
   * Canto do retângulo do grupo: escala todas as janelas na mesma proporção, a partir do
   * canto superior esquerdo do grupo. Texto escala a fonte; notas/terminais/imagens o tamanho.
   */
  const startGroupResize = (e: React.PointerEvent<HTMLElement>, box: { group: string; x: number; y: number; w: number; h: number }) => {
    setSelection({ ids: [], focus: null, group: box.group });
    const members = nodesRef.current.filter((n) => n.group === box.group);
    const start = new Map(members.map((n) => [n.id, n]));
    // Menor escala possível: nenhuma janela abaixo do mínimo dela (texto: fonte mínima).
    const minScale = Math.max(
      0.05,
      ...members.map((n) =>
        n.type === "text"
          ? TEXT_SIZE_MIN / n.size
          : Math.max(minSize(n.type).w / Math.max(n.w, 1), minSize(n.type).h / Math.max(n.h, 1)),
      ),
    );
    const maxScale = Math.min(
      20,
      ...members.filter((n) => n.type === "text").map((n) => TEXT_SIZE_MAX / (n as TextNodeData).size),
    );
    const ratio = box.w / Math.max(box.h, 1);
    const zoom = pan.getView().zoom;
    dragPointer(e, (dx, dy) => {
      const d = Math.abs(dx) > Math.abs(dy * ratio) ? dx : dy * ratio;
      const k = Math.min(maxScale, Math.max(minScale, (box.w + d / zoom) / Math.max(box.w, 1)));
      update((list) =>
        list.map((n) => {
          const s0 = start.get(n.id);
          if (!s0) return n;
          const pos = { x: box.x + (s0.x - box.x) * k, y: box.y + (s0.y - box.y) * k };
          if (s0.type === "text") {
            const size = Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(s0.size * k)));
            return { ...n, ...pos, size } as CanvasNodeData;
          }
          return { ...n, ...pos, w: s0.w * k, h: s0.h * k } as CanvasNodeData;
        }),
      );
    });
  };

  // Fecha o painel "Uso dos Agentes" ao clicar fora dele (e fora da pílula).
  useEffect(() => {
    if (!usageOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!agentsRef.current?.contains(e.target as Node)) setUsageOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [usageOpen]);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  // Status do Script selecionado (o botão Executar/Parar da barra acompanha).
  const selectedScriptState = useScriptState(selectedNode?.type === "script" ? selectedNode.id : null);

  const scriptActions = (s: ScriptNodeData): NodeAction[][] => {
    const running = selectedScriptState.status === "running";
    return [
      [
        { label: "Status", display: true, content: scriptStatusText(selectedScriptState) },
      ],
      [
        { icon: SquarePen, label: "Renomear", onClick: () => setEditingTitleId(s.id) },
        { icon: Code, label: "Editar comando", onClick: () => scriptAction(s.id, "edit") },
      ],
      [
        running
          ? { icon: Square, label: "Parar", onClick: () => scriptAction(s.id, "stop") }
          : { icon: Play, label: s.approved ? "Executar" : "Revisar e aprovar", onClick: () => scriptAction(s.id, "run") },
        { icon: RotateCw, label: "Reiniciar", onClick: () => scriptAction(s.id, "run") },
        s.expanded
          ? { icon: ChevronUp, label: "Recolher", onClick: () => scriptAction(s.id, "collapse") }
          : { icon: ChevronDown, label: "Expandir (logs)", onClick: () => scriptAction(s.id, "expand") },
      ],
      [{ icon: Trash2, label: "Excluir", onClick: () => deleteNode(s) }],
    ];
  };

  return (
    <main
      ref={pan.ref}
      className={`canvas${pan.panning ? " panning" : ""}${DRAW_TOOLS.includes(tool) ? " tool-terminal" : ""}${
        tool === "text" ? " tool-text" : ""
      }${spacePan ? " space-pan" : ""}${fsNode ? " has-fullscreen" : ""}`}
      onPointerDown={onCanvasPointerDown}
      onDoubleClick={(e) => {
        // Duplo clique no cabeçalho de uma janela: centraliza (igual à lista de janelas).
        if (fsNode) return; // em tela cheia não há o que centralizar
        const target = e.target as HTMLElement;
        if (target.closest("button, input, textarea, select, a")) return;
        if (!target.closest(".term-header, .note-header, .fb-header, .pt-header, .at-header, .bd-header, .sc-bar")) return;
        const id = target.closest<HTMLElement>(".canvas-node")?.dataset.nodeId;
        const n = id ? nodesRef.current.find((x) => x.id === id) : undefined;
        if (n) goToNode(n);
      }}
      onPointerDownCapture={(e) => {
        // Espaço + clique numa janela não selecionada: move o canvas em vez de agir na janela.
        if (e.button !== 0 || !spaceHeld.current) return;
        const node = (e.target as HTMLElement).closest(".canvas-node");
        if (!node || node.classList.contains("selected")) return;
        e.stopPropagation();
        e.preventDefault();
        pan.onPointerDown(e, true);
      }}
      onPointerMove={(e) => (lastPointer.current = { x: e.clientX, y: e.clientY })}
    >
      {/* Mundo do canvas: os cards ficam aqui, posicionados pela visão (pan/zoom). */}
      <div className="canvas-world">
        {/* Grupos conectados: retângulo tracejado cinza em volta de todo o grupo, sempre visível */}
        {project &&
          groupBoxes(nodes).map((b) => (
            <div
              key={b.group}
              className={`group-rect${selection.group === b.group ? " selected" : ""}`}
              style={{ "--nx": b.x, "--ny": b.y, "--nw": b.w, "--nh": b.h } as React.CSSProperties}
              title="Grupo conectado: arraste para mover, canto para redimensionar"
              onPointerDown={(e) => startGroupMove(e, b.group)}
            >
              <div className="node-resize" title="Redimensionar grupo" onPointerDown={(e) => startGroupResize(e, b)} />
            </div>
          ))}

        {project &&
          nodes.map((n) =>
            n.type === "script" ? (
              <ScriptNode
                key={n.id}
                node={n}
                space={project.space}
                projectId={project.id}
                zoom={pan.zoom}
                selected={selection.ids.includes(n.id)}
                editingTitle={n.id === editingTitleId}
                editingCommand={n.id === editingCommandId}
                onSelect={selectNode}
                onChange={changeNode}
                onTitleDone={finishTitle}
                onCommandDone={finishCommand}
                onAction={scriptAction}
              />
            ) : n.type === "board" ? (
              <BoardNode
                key={n.id}
                node={n}
                space={project.space}
                projectId={project.id}
                zoom={n.id === fsNode?.id || n.id === fsLeaving?.id ? 1 : pan.zoom}
                selected={selection.ids.includes(n.id)}
                onSelect={selectNode}
                fullscreen={n.id === fsNode?.id || n.id === fsLeaving?.id}
                onToggleFullscreen={toggleFullscreen}
                onChange={changeNode}
              />
            ) : n.type === "attachment" ? (
              <AttachmentNode
                key={n.id}
                node={n}
                space={project.space}
                projectId={project.id}
                zoom={n.id === fsNode?.id || n.id === fsLeaving?.id ? 1 : pan.zoom}
                selected={selection.ids.includes(n.id)}
                onSelect={selectNode}
                fullscreen={n.id === fsNode?.id || n.id === fsLeaving?.id}
                onToggleFullscreen={toggleFullscreen}
                onChange={changeNode}
                onError={toast.show}
              />
            ) : n.type === "portal" ? (
              <PortalNode
                key={n.id}
                node={n}
                space={project.space}
                projectId={project.id}
                zoom={n.id === fsNode?.id || n.id === fsLeaving?.id ? 1 : pan.zoom}
                selected={selection.ids.includes(n.id)}
                autoFocus={n.id === focusNoteId}
                onSelect={selectNode}
                fullscreen={n.id === fsNode?.id || n.id === fsLeaving?.id}
                onToggleFullscreen={toggleFullscreen}
                onChange={changeNode}
              />
            ) : n.type === "folder" ? (
              <FolderNode
                key={n.id}
                node={n}
                space={project.space}
                projectId={project.id}
                projectName={project.name}
                zoom={n.id === fsNode?.id || n.id === fsLeaving?.id ? 1 : pan.zoom}
                selected={selection.ids.includes(n.id)}
                onSelect={selectNode}
                fullscreen={n.id === fsNode?.id || n.id === fsLeaving?.id}
                onToggleFullscreen={toggleFullscreen}
                onChange={changeNode}
                onError={toast.show}
              />
            ) : n.type === "text" ? (
              <TextNode
                key={n.id}
                node={n}
                zoom={n.id === fsNode?.id || n.id === fsLeaving?.id ? 1 : pan.zoom}
                selected={selection.ids.includes(n.id)}
                editing={n.id === editingTextId}
                onSelect={selectNode}
                onChange={changeNode}
                onStartEdit={setEditingTextId}
                onEndEdit={endTextEdit}
              />
            ) : n.type === "image" ? (
              <ImageNode
                key={n.id}
                node={n}
                space={project.space}
                projectId={project.id}
                zoom={n.id === fsNode?.id || n.id === fsLeaving?.id ? 1 : pan.zoom}
                selected={selection.ids.includes(n.id)}
                onSelect={selectNode}
                fullscreen={n.id === fsNode?.id || n.id === fsLeaving?.id}
                onToggleFullscreen={toggleFullscreen}
                onChange={changeNode}
              />
            ) : n.type === "note" ? (
              <NoteNode
                key={n.id}
                node={n}
                zoom={n.id === fsNode?.id || n.id === fsLeaving?.id ? 1 : pan.zoom}
                selected={selection.ids.includes(n.id)}
                editingTitle={n.id === editingTitleId}
                autoFocus={n.id === focusNoteId}
                onSelect={selectNode}
                fullscreen={n.id === fsNode?.id || n.id === fsLeaving?.id}
                onToggleFullscreen={toggleFullscreen}
                onChange={changeNode}
                onTitleDone={finishTitle}
              />
            ) : (
            <TerminalNode
              key={n.id}
              node={n}
              space={project.space}
              projectId={project.id}
              zoom={n.id === fsNode?.id || n.id === fsLeaving?.id ? 1 : pan.zoom}
              selected={selection.ids.includes(n.id)}
              editingTitle={n.id === editingTitleId}
              onSelect={selectNode}
              fullscreen={n.id === fsNode?.id || n.id === fsLeaving?.id}
              onToggleFullscreen={toggleFullscreen}
              onChange={changeNode}
              onTitleDone={finishTitle}
            />
            ),
          )}

        {/* Janelas que o agente acabou de criar/alterar: contorno roxo + nome do agente */}
        {project &&
          nodes
            .filter((n) => activity.marks[n.id])
            .map((n) => (
              <div
                key={`agent-mark-${n.id}-${activity.marks[n.id].n}`}
                className="agent-mark"
                style={{ "--nx": n.x, "--ny": n.y, "--nw": n.w, "--nh": n.h } as React.CSSProperties}
              >
                <span className="agent-mark-badge">
                  <Bot size={12} />
                  {activity.marks[n.id].agent}
                </span>
              </div>
            ))}
      </div>

      {/* Seleção por arraste */}
      {marquee && (
        <div className="marquee-rect" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
      )}

      {/* Retângulo do terminal sendo desenhado */}
      {draft && (
        <div className="draw-rect" style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }} />
      )}

      {!project && <div className="canvas-empty">Selecione um projeto na barra lateral</div>}

      {/* Agente pediu para excluir uma janela: mesma confirmação, dizendo quem pediu */}
      {agentDeletePresence.mounted &&
        agentDelete &&
        (() => {
          const texts = deleteTexts([agentDelete.id]);
          return (
            <ConfirmDeleteModal
              {...texts}
              message={`${agentDelete.agent} pediu para excluir esta janela. ${texts.message}`}
              detail=""
              confirmLabel="Excluir"
              closing={agentDeletePresence.closing}
              onCancel={() => agentDelete.answer(false)}
              onConfirm={() => agentDelete.answer(true)}
            />
          );
        })()}

      {/* Tecla Delete: confirmação antes de excluir a seleção */}
      {confirmDelete.mounted && pendingDelete.length > 0 && (
        <ConfirmDeleteModal
          {...deleteTexts(pendingDelete)}
          detail=""
          confirmLabel="Excluir"
          closing={confirmDelete.closing}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => {
            setConfirmDeleteOpen(false);
            deleteIds(pendingDelete);
          }}
        />
      )}

      {/* Faixa invisível para arrastar a janela (duplo clique maximiza) */}
      <div className="drag-region" data-tauri-drag-region />

      {/* Topo: menu, toolbar e ações */}
      <div className="canvas-menu">
        <button className="round-btn" title="Menu" onClick={onToggleSidebar}>
          <Menu size={18} />
        </button>
        {sidebarCollapsed && project && (
          <div className="ws-pill" title={`${project.space} / ${project.id}`}>
            <Folder size={16} color={project.color} strokeWidth={1.8} />
            <span>{project.name}</span>
          </div>
        )}
      </div>

      <div className="toolbar">
        {tools.map(({ id, icon: Icon, label }) => {
          const needsProject = (DRAW_TOOLS.includes(id) || id === "attach") && !project;
          return (
            <button
              key={id}
              className={`tool${tool === id ? " active" : ""}`}
              title={needsProject ? `${label} (abra um projeto primeiro)` : label}
              disabled={needsProject}
              onClick={() => {
                if (id === "attach") {
                  setTool("select");
                  pickAttachments().catch((e) => toast.show(String(e)));
                } else if (WORKING_TOOLS.includes(id)) setTool(id);
              }}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>

      {/* Segunda barra (várias selecionadas): conectar / desconectar / excluir */}
      {!selectedNode && (selection.ids.length > 1 || selection.group) && (
        <div className="toolbar node-toolbar" key="multi">
          {multiActions().map((group, gi) => (
            <Fragment key={gi}>
              {gi > 0 && <span className="toolbar-divider" />}
              {group.map(({ icon: Icon, content, display, label, onClick }) =>
                display ? (
                  <span key={label} className="tool-value tool-count">
                    {content}
                  </span>
                ) : (
                  <button
                    key={label}
                    className="tool"
                    title={label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => onClick?.(e)}
                  >
                    {Icon && <Icon size={17} />}
                  </button>
                ),
              )}
            </Fragment>
          ))}
        </div>
      )}

      {/* Segunda barra: ações do card selecionado */}
      {selectedNode && (
        <div className="toolbar node-toolbar" key={selectedNode.type}>
          {(selectedNode.type === "note"
            ? noteActions(selectedNode)
            : selectedNode.type === "script"
              ? scriptActions(selectedNode)
            : selectedNode.type === "text"
              ? textActions(selectedNode)
              : selectedNode.type === "image" ||
                selectedNode.type === "folder" ||
                selectedNode.type === "portal" ||
                selectedNode.type === "attachment"
              ? [[{ icon: Trash2, label: "Excluir", onClick: () => deleteNode(selectedNode) }]]
              : [
                [{ icon: SquarePen, label: "Renomear", onClick: () => setEditingTitleId(selectedNode.id) }],
                [
                  { icon: MessagesSquare, label: "Chat" },
                  { icon: PanelBottom, label: "Painel" },
                ],
                [{ icon: GitBranch, label: "Git" }],
                [{ icon: RotateCw, label: "Reiniciar", onClick: () => terminals.restart(selectedNode.id) }],
                [{ icon: Trash2, label: "Excluir", onClick: () => deleteNode(selectedNode) }],
              ]
          ).map((group: NodeAction[], gi) => (
            <Fragment key={gi}>
              {gi > 0 && <span className="toolbar-divider" />}
              {group.map(({ icon: Icon, content, display, onScrub, label, onClick, active, popover: kind }) =>
                display ? (
                  <span
                    key={label}
                    className={`tool-value${onScrub ? " scrub-value" : ""}`}
                    title={label}
                    onPointerDown={onScrub}
                  >
                    {content}
                  </span>
                ) : (
                <button
                  key={label}
                  className={`tool${content !== undefined ? " tool-text" : ""}${
                    active || (kind && popoverOpen && popover?.kind === kind) ? " active" : ""
                  }`}
                  title={label}
                  onMouseDown={(e) => {
                    // Não tira o foco do texto da nota (a formatação usa a seleção) e não
                    // conta como "clique fora" do painel aberto (o próprio botão alterna).
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    if (kind) {
                      togglePopover(kind, selectedNode.id, e.currentTarget);
                    } else {
                      closePopover();
                      onClick?.(e);
                    }
                  }}
                >
                  {Icon ? <Icon size={17} /> : content}
                </button>
                ),
              )}
            </Fragment>
          ))}
        </div>
      )}

      {/* Lista das janelas abertas no canvas */}
      {project && nodes.length > 0 && (
        <div ref={windowsRef} className={`canvas-windows${windowsOpen ? " open" : ""}`}>
          <button
            className="cw-header"
            title={windowsOpen ? "Recolher lista" : "Mostrar janelas do canvas"}
            onClick={() => setWindowsOpen((o) => !o)}
          >
            <LayoutList size={14} />
            <span>Janelas</span>
            <span className="cw-count">{nodes.length}</span>
            <ChevronDown size={14} className="cw-chevron" />
          </button>
          <div className="cw-body">
            <div className="cw-list">
          {nodes.map((n) => (
            <button
              key={n.id}
              className={`cw-item${selection.ids.includes(n.id) ? " active" : ""}`}
              title={`Ir para "${windowLabel(n)}"`}
              onClick={() => goToNode(n)}
            >
              <span className="cw-icon">{windowIcon(n)}</span>
              <span className="cw-label">{windowLabel(n)}</span>
            </button>
          ))}
            </div>
          </div>
        </div>
      )}

      <div className="top-actions">
        <button className="icon-btn" title="Docs">
          <BookOpen size={16} />
        </button>
        <span className="divider" />
        <button className="icon-btn" title="Código">
          <Code size={16} />
        </button>
        <button className="icon-btn" title="Mais">
          <ChevronDown size={14} />
        </button>
        <div className="window-controls">
          <button className="win-btn" title="Minimizar" onClick={() => appWindow.minimize()}>
            <Minus size={16} />
          </button>
          <button className="win-btn" title="Maximizar" onClick={() => appWindow.toggleMaximize()}>
            <Square size={13} />
          </button>
          <button className="win-btn close" title="Fechar" onClick={() => appWindow.close()}>
            <X size={17} />
          </button>
        </div>
      </div>

      {/* Controles inferiores */}
      <div className="bottom-controls">
        {project && activity.actions.length > 0 && (
          <div className="activity-anchor" ref={activityRef}>
            {activityOpen && (
              <div className="activity-panel">
                <div className="activity-head">
                  <span>Atividade do agente</span>
                  <span className="activity-hint">Ctrl+Z desfaz a última</span>
                </div>
                <div className="activity-list">
                  {activity.actions.map((a) => (
                    <div key={a.id} className={`activity-item${a.undone ? " undone" : ""}`}>
                      <span className="activity-time">
                        {new Date(a.time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="activity-text">
                        <b>{a.agent}</b> {a.text}
                        {a.undone && <em> (desfeito)</em>}
                      </span>
                      {a === activity.latestUndoable && (
                        <button className="activity-undo" onClick={() => undoAgent()}>
                          Desfazer
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              className={`pill-btn activity-btn${activityOpen ? " active" : ""}`}
              title="Atividade do agente"
              onClick={() => setActivityOpen((o) => !o)}
            >
              <Bot size={18} />
              {activity.unseen > 0 && !activityOpen && <span className="activity-badge">{activity.unseen}</span>}
            </button>
          </div>
        )}
        <button className="pill-btn" title="Camadas">
          <Layers size={18} />
        </button>
        <div className="agents-anchor" ref={agentsRef}>
          {usage.mounted && (
            <AgentUsagePopover closing={usage.closing} usage={agentUsage.usage} onRefresh={agentUsage.refresh} />
          )}
          <button
            className={`pill-btn agents${usageOpen ? " active" : ""}`}
            title="Uso dos Agentes"
            onClick={() => setUsageOpen((o) => !o)}
          >
            <RingGauge
              size={24}
              rings={pillRings(agentUsage.usage.claude)}
              color="#e07a55"
              track="#4a3430"
              strokeWidth={2.5}
              gap={1.5}
            />
            <span className="agents-pct">
              <span>5h: {pillText(agentUsage.usage.claude).five}</span>
              <span>7d: {pillText(agentUsage.usage.claude).week}</span>
            </span>
            <RingGauge
              size={24}
              rings={pillRings(agentUsage.usage.codex)}
              color="#3b82f6"
              track="#2a3d66"
              strokeWidth={2.5}
              gap={1.5}
            />
          </button>
        </div>
        <button className="pill-btn" title="Ver todas as janelas (clique de novo para voltar)" onClick={fitAll} disabled={!project || nodes.length === 0}>
          <MapIcon size={18} />
        </button>
        <div className="zoom">
          <button
            className="icon-btn"
            title="Diminuir zoom"
            onClick={pan.zoomOut}
            disabled={pan.zoom <= ZOOM_MIN}
          >
            <Minus size={16} />
          </button>
          <button
            className="zoom-value"
            title="Arraste para ajustar o zoom · clique para 100%"
            onPointerDown={pan.onZoomScrubStart}
          >
            {Math.round(pan.zoom * 100)}%
          </button>
          <button
            className="icon-btn"
            title="Aumentar zoom"
            onClick={pan.zoomIn}
            disabled={pan.zoom >= ZOOM_MAX}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Painéis da barra da nota (cor, tamanho, fonte, título) */}
      {popoverPresence.mounted &&
        popover &&
        (() => {
          const textNode = nodes.find((n): n is TextNodeData => n.id === popover.noteId && n.type === "text");
          if (textNode) {
            return (
              <NotePopover
                key={popover.kind}
                x={popover.x}
                y={popover.y}
                closing={popoverPresence.closing}
                onClose={closePopover}
                className="np-color"
              >
                <TextColorPicker
                  current={textNode.color}
                  onPick={(color) => {
                    patchNode(textNode.id, { color });
                    closePopover();
                  }}
                  onCustom={(color) => patchNode(textNode.id, { color })}
                />
              </NotePopover>
            );
          }
          const note = nodes.find((n): n is NoteNodeData => n.id === popover.noteId && n.type === "note");
          if (!note) return null;
          return (
            <NotePopover
              key={popover.kind}
              x={popover.x}
              y={popover.y}
              closing={popoverPresence.closing}
              onClose={closePopover}
              className={`np-${popover.kind}`}
            >
              {popover.kind === "color" && (
                <ColorPicker
                  current={note.color}
                  onPick={(color) => {
                    patchNode(note.id, { color });
                    setLastNoteColor(color);
                    closePopover();
                  }}
                  onCustom={(color) => {
                    patchNode(note.id, { color });
                    setLastNoteColor(color);
                  }}
                />
              )}
              {popover.kind === "size" && (
                <FontSizeStepper size={note.fontSize} onChange={(fontSize) => patchNode(note.id, { fontSize })} />
              )}
              {popover.kind === "font" && (
                <FontPicker
                  current={note.font}
                  onPick={(font) => {
                    patchNode(note.id, { font });
                    closePopover();
                  }}
                />
              )}
              {popover.kind === "heading" && (
                <HeadingMenu
                  onPick={(level) => {
                    closePopover();
                    formatNote(note, `h${level}`);
                  }}
                />
              )}
            </NotePopover>
          );
        })()}

      {/* Menu "o que rodar" ao soltar o retângulo */}
      {createPresence.mounted && createMenu && (
        <ContextMenu
          x={createMenu.x}
          y={createMenu.y}
          items={createItems(createMenu.rect)}
          closing={createPresence.closing}
          onClose={closeCreateMenu}
        />
      )}

      {/* Arrastando imagens do Explorer sobre a janela */}
      {dropActive && <div className="drop-overlay">Solte para anexar ao canvas</div>}

      {toast.presence.mounted && (
        <div className={`toast${toast.presence.closing ? " closing" : ""}`} role="alert" onClick={toast.hide}>
          {toast.message}
        </div>
      )}
    </main>
  );
}
