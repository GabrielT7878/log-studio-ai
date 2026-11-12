// Chamadas ao backend Rust (comandos Tauri).
import { invoke, type Channel } from "@tauri-apps/api/core";
import type { AgentKind, CanvasNodeData } from "./canvasNodes";
import type { DropPos } from "../hooks/useTreeDrag";
import type { CanvasView, TreeNode } from "../hooks/useWorkspaceTree";

export interface Settings {
  projectsRoot: string;
}

/** Espaços de trabalho existentes e o selecionado. */
export interface SpacesInfo {
  spaces: string[];
  current: string;
}

/** Evento de um terminal: saída de texto ou fim do processo. */
export type PtyEvent = { type: "data"; data: string } | { type: "exit"; code: number | null };

/** Item de uma pasta do projeto (navegador "Pasta"). */
export interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
  /** ms desde 1970 */
  modified: number;
}

export type FsTextFile = { kind: "text"; content: string } | { kind: "binary" } | { kind: "tooLarge"; size: number };

export interface FsSearchHit {
  /** Caminho relativo ao projeto, com "/". */
  path: string;
  isDir: boolean;
}

/** Anexo gravado no projeto. */
export interface Attached {
  file: string;
  name: string;
  size: number;
}

/** Um limite do plano do agente (sessão de 5h, semanal, semanal por modelo). */
export interface AgentLimit {
  /** "session", "weekly_all", "weekly_scoped"… */
  kind: string;
  /** "session" ou "weekly". */
  group: string;
  /** Nome do modelo nos limites por modelo (ex.: "Fable"). */
  model: string | null;
  /** 0–100 */
  percent: number;
  severity: string | null;
  /** ISO 8601 */
  resetsAt: string | null;
}

/** Uso do plano de um agente, lido pelo próprio CLI. */
export type AgentUsageReport =
  | { status: "ok"; plan: string | null; available: boolean; limits: AgentLimit[] }
  | { status: "notInstalled" }
  | { status: "error"; message: string };

interface Created {
  tree: TreeNode[];
  id: string;
}

export const api = {
  // Configurações
  getSettings: () => invoke<Settings>("get_settings"),
  setProjectsRoot: (path: string) => invoke<Settings>("set_projects_root", { path }),

  // Espaços de trabalho
  listSpaces: () => invoke<SpacesInfo>("list_spaces"),
  createSpace: (name: string) => invoke<SpacesInfo>("create_space", { name }),
  selectSpace: (name: string) => invoke<void>("select_space", { name }),
  renameSpace: (oldName: string, newName: string) =>
    invoke<SpacesInfo>("rename_space", { oldName, newName }),
  deleteSpace: (name: string) => invoke<SpacesInfo>("delete_space", { name }),

  // Árvore de pastas/projetos do espaço `space`
  loadTree: (space: string) => invoke<TreeNode[]>("load_tree", { space }),
  createFolder: (space: string, parent: string | null) =>
    invoke<Created>("create_folder", { space, parent }),
  createProject: (space: string, parent: string | null) =>
    invoke<Created>("create_project", { space, parent }),
  rename: (space: string, id: string, name: string) =>
    invoke<TreeNode[]>("rename_node", { space, id, name }),
  remove: (space: string, id: string) => invoke<TreeNode[]>("delete_node", { space, id }),
  move: (space: string, dragId: string, targetId: string | null, pos: DropPos) =>
    invoke<TreeNode[]>("move_node", { space, dragId, targetId, pos }),
  setExpanded: (space: string, id: string, expanded: boolean) =>
    invoke<void>("set_expanded", { space, id, expanded }),
  openInExplorer: (space: string, id: string) => invoke<void>("open_in_explorer", { space, id }),

  // Projeto aberto no canvas e a sua visualização (posição/zoom)
  setActiveProject: (space: string, id: string | null) =>
    invoke<void>("set_active_project", { space, id }),
  saveProjectView: (space: string, id: string, view: CanvasView) =>
    invoke<void>("save_project_view", { space, id, view }),
  saveProjectCanvas: (space: string, id: string, nodes: CanvasNodeData[]) =>
    invoke<void>("save_project_canvas", { space, id, nodes }),

  // Imagens do canvas (arquivos em <projeto>/.logstudio/imagens/)
  /** Bytes da imagem vão crus no corpo; espaço/projeto em cabeçalhos (codificados). */
  /** `name` (opcional): nome original, usado no nome do arquivo salvo. */
  saveCanvasImage: (space: string, projectId: string, bytes: Uint8Array, name?: string) =>
    invoke<string>("save_canvas_image", bytes, {
      headers: {
        "x-space": encodeURIComponent(space),
        "x-project": encodeURIComponent(projectId),
        ...(name ? { "x-name": encodeURIComponent(name) } : {}),
      },
    }),
  importCanvasImages: (space: string, projectId: string, paths: string[]) =>
    invoke<string[]>("import_canvas_images", { space, projectId, paths }),
  readCanvasImage: (space: string, projectId: string, file: string) =>
    invoke<ArrayBuffer>("read_canvas_image", { space, projectId, file }),
  deleteCanvasImage: (space: string, projectId: string, file: string) =>
    invoke<void>("delete_canvas_image", { space, projectId, file }),

  // Navegador de arquivos ("Pasta"): caminhos relativos ao projeto
  fsList: (space: string, projectId: string, rel: string) => invoke<FsEntry[]>("fs_list", { space, projectId, rel }),
  fsReadText: (space: string, projectId: string, rel: string) =>
    invoke<FsTextFile>("fs_read_text", { space, projectId, rel }),
  fsReadBytes: (space: string, projectId: string, rel: string) =>
    invoke<ArrayBuffer>("fs_read_bytes", { space, projectId, rel }),
  fsWriteText: (space: string, projectId: string, rel: string, content: string) =>
    invoke<void>("fs_write_text", { space, projectId, rel, content }),
  /** Cria arquivo vazio ou pasta em `dir`; devolve o caminho relativo criado. */
  fsCreate: (space: string, projectId: string, dir: string, name: string, isDir: boolean) =>
    invoke<string>("fs_create", { space, projectId, dir, name, isDir }),
  /** Move um item para dentro de `toDir`; devolve o novo caminho relativo. */
  fsMove: (space: string, projectId: string, from: string, toDir: string) =>
    invoke<string>("fs_move", { space, projectId, from, toDir }),
  fsSearch: (space: string, projectId: string, query: string) =>
    invoke<FsSearchHit[]>("fs_search", { space, projectId, query }),

  // Portal: o site permite ser mostrado dentro do app (iframe)?
  portalCheck: (url: string) => invoke<{ blocked: boolean }>("portal_check", { url }),

  // Anexos (arquivos em <projeto>/.logstudio/anexos/)
  importAttachments: (space: string, projectId: string, paths: string[]) =>
    invoke<Attached[]>("import_attachments", { space, projectId, paths }),
  /** Bytes crus no corpo; espaço/projeto/nome em cabeçalhos (codificados). */
  saveAttachment: (space: string, projectId: string, name: string, bytes: Uint8Array) =>
    invoke<Attached>("save_attachment", bytes, {
      headers: {
        "x-space": encodeURIComponent(space),
        "x-project": encodeURIComponent(projectId),
        "x-name": encodeURIComponent(name),
      },
    }),
  attachmentSrc: (space: string, projectId: string, file: string) =>
    invoke<string>("attachment_src", { space, projectId, file }),
  attachmentReadText: (space: string, projectId: string, file: string) =>
    invoke<FsTextFile>("attachment_read_text", { space, projectId, file }),
  openAttachment: (space: string, projectId: string, file: string) =>
    invoke<void>("open_attachment", { space, projectId, file }),
  revealAttachment: (space: string, projectId: string, file: string) =>
    invoke<void>("reveal_attachment", { space, projectId, file }),
  deleteAttachment: (space: string, projectId: string, file: string) =>
    invoke<void>("delete_attachment", { space, projectId, file }),

  // Uso do plano dos agentes (pede ao CLI do agente; leva ~1–5 s)
  agentUsage: (agent: "claude" | "codex") => invoke<AgentUsageReport>("agent_usage", { agent }),

  // Ponte do agente: resposta do canvas a um pedido (ferramenta MCP)
  agentReply: (reqId: number, ok: boolean, result: unknown) =>
    invoke<void>("agent_reply", { reqId, ok, result }),
  /** Imagem/anexo pedidos pelo agente: caminho (absoluto ou relativo ao projeto) ou URL. */
  agentImportImage: (space: string, projectId: string, source: string) =>
    invoke<string>("agent_import_image", { space, projectId, source }),
  agentAttachFile: (space: string, projectId: string, source: string) =>
    invoke<Attached>("agent_attach_file", { space, projectId, source }),

  // Quadros (Excalidraw): arquivo .logstudio/quadros/<id>.excalidraw (null = ainda não existe)
  boardLoad: (space: string, projectId: string, id: string) =>
    invoke<string | null>("board_load", { space, projectId, id }),
  boardSave: (space: string, projectId: string, id: string, content: string) =>
    invoke<void>("board_save", { space, projectId, id, content }),
  boardDelete: (space: string, projectId: string, id: string) =>
    invoke<void>("board_delete", { space, projectId, id }),

  // Fontes instaladas no sistema
  listFonts: () => invoke<string[]>("list_fonts"),

  // Terminais (PTY)
  ptySpawn: (
    id: string,
    space: string,
    project: string,
    agent: AgentKind,
    cols: number,
    rows: number,
    onEvent: Channel<PtyEvent>,
  ) => invoke<void>("pty_spawn", { id, space, project, agent, cols, rows, onEvent }),
  ptyWrite: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  ptyKill: (id: string) => invoke<void>("pty_kill", { id }),
  ptyKillAll: () => invoke<void>("pty_kill_all"),
};
