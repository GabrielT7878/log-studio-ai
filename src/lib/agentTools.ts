// Ferramentas que o agente (Claude Code no terminal) usa no canvas, via ponte MCP do Rust
// (src-tauri/src/agent_bridge.rs). Cada ferramenta devolve o resultado para o agente e,
// se for o caso, uma mudança na lista de janelas. O que depende do app (importar arquivos,
// confirmar, excluir, centralizar) chega em `ToolDeps`.

import { normalizeUrl } from "../components/PortalNode";
import type { Attached } from "./api";
import { attachmentKind, attachmentSize } from "./attachments";
import { boardPath } from "./boardScenes";
import {
  AGENTS,
  BOARD_DEFAULT_H,
  BOARD_DEFAULT_TITLE,
  BOARD_DEFAULT_W,
  FOLDER_DEFAULT_H,
  FOLDER_DEFAULT_W,
  FOLDER_DEFAULTS,
  IMAGE_INITIAL_MAX,
  NOTE_DEFAULT_H,
  NOTE_DEFAULT_W,
  NOTE_DEFAULTS,
  NOTE_FONT_MAX,
  NOTE_FONT_MIN,
  PORTAL_DEFAULT_H,
  normalizePortalFile,
  PORTAL_DEFAULT_W,
  TEXT_DEFAULTS,
  TEXT_FAMILIES,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_WEIGHTS,
  getLastNoteColor,
  isNoteColor,
  minSize,
  normalizeGroups,
  type AttachmentNodeData,
  type BoardNodeData,
  type CanvasNodeData,
  type FolderNodeData,
  type ImageNodeData,
  type NodePatch,
  type NoteNodeData,
  type PortalNodeData,
  type ScriptNodeData,
  SCRIPT_COLLAPSED_H,
  SCRIPT_DEFAULT_OPEN_H,
  SCRIPT_DEFAULT_TITLE,
  SCRIPT_DEFAULT_W,
  SCRIPT_MAX,
  type TextFamily,
  type TextNodeData,
  type TextWeight,
} from "./canvasNodes";
import type { ScriptState } from "./terminals";

/** Pedido vindo do Rust (evento "agent-request"). */
export interface AgentRequest {
  reqId: number;
  terminalId: string;
  space: string;
  projectId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolContext {
  /** Janelas atuais (sempre a lista mais recente, mesmo depois de esperar). */
  getNodes: () => CanvasNodeData[];
  /** Ids das janelas selecionadas pelo usuário. */
  selectedIds: string[];
  /** Terminal do agente que pediu. */
  terminalId: string;
}

/** O que a ferramenta precisa do app. */
export interface ToolDeps {
  importImage: (source: string) => Promise<string>;
  attachFile: (source: string) => Promise<Attached>;
  imageSize: (file: string) => Promise<{ w: number; h: number }>;
  /** Lança erro se a pasta não existir no projeto. */
  checkDir: (dir: string) => Promise<void>;
  /** Pergunta ao usuário se pode excluir a janela (mesmo diálogo da exclusão manual). */
  confirmDelete: (node: CanvasNodeData) => Promise<boolean>;
  /** Exclui a janela (encerra terminal, manda arquivo para a Lixeira). */
  deleteNode: (node: CanvasNodeData) => void;
  /** Seleciona e centraliza a janela. */
  focus: (node: CanvasNodeData) => void;
  /** Altera elementos de um quadro pelo id. */
  updateBoard: (
    boardId: string,
    patches: BoardPatch[],
  ) => Promise<{ changed: string[]; missing: string[]; revert: () => void }>;
  /** Remove elementos de um quadro (com textos e setas ligados). */
  removeFromBoard: (boardId: string, ids: string[]) => Promise<{ removed: string[]; found: string[]; revert: () => void }>;
  /** PNG (base64) e lista de elementos do quadro. */
  snapshotBoard: (boardId: string) => Promise<{ png: string; elements: unknown[] }>;
  /** Acrescenta elementos (formato "skeleton" do Excalidraw) a um quadro. */
  drawOnBoard: (
    boardId: string,
    skeletons: unknown[],
    clear: boolean,
    links: { arrowId: string; from?: string; to?: string }[],
  ) => Promise<{ added: number; overlapping: string[]; revert: () => void }>;
  /** Desloca elementos em lote (ids e/ou tudo abaixo de belowY). */
  moveOnBoard: (
    boardId: string,
    sel: { ids?: string[]; belowY?: number },
    dx: number,
    dy: number,
  ) => Promise<{ moved: string[]; missing: string[]; overlapping: string[]; revert: () => void }>;
  /** Roda (ou roda de novo) um Script já aprovado; devolve o estado. */
  runScript: (node: ScriptNodeData) => ScriptState;
  /** Para um Script; devolve o estado. */
  stopScript: (node: ScriptNodeData) => ScriptState;
  scriptState: (id: string) => ScriptState;
  /** Últimas `n` linhas da saída do Script. */
  scriptLines: (id: string, n: number) => string[];
}

/** Alteração de um elemento de quadro (board_update). */
export interface BoardPatch {
  id: string;
  x?: number;
  y?: number;
  points?: [number, number][];
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  strokeColor?: string;
  backgroundColor?: string;
}

export interface ToolOutcome {
  result: unknown;
  /** Mudança a aplicar nas janelas (sobre a lista mais recente). */
  apply?: (list: CanvasNodeData[]) => CanvasNodeData[];
  /** Descrição para o registro de atividade (ações que mudam algo; leituras não têm). */
  log?: string;
  /** Janelas a destacar mesmo sem mudança (ex.: centralizar). */
  touched?: string[];
  /** Desfazer que não é mudança de janelas (ex.: desenho num quadro). */
  revert?: () => void;
}

/** Erro mostrado ao agente (mensagem clara do que corrigir). */
export class ToolError extends Error {}

const MAX_TEXT = 50_000;
const PREVIEW = 120;
const GAP = 40;
const COLOR_HELP = "use yellow, pink, blue, green, orange, purple, white, black, slate, navy ou #rrggbb";

const round = (v: number) => Math.round(v);
const clip = (s: string, n = PREVIEW) => (s.length > n ? `${s.slice(0, n)}…` : s);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function str(args: Record<string, unknown>, key: string, max = MAX_TEXT): string | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new ToolError(`"${key}" deve ser texto.`);
  if (v.length > max) throw new ToolError(`"${key}" passa do limite de ${max} caracteres.`);
  return v;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (!isNum(v)) throw new ToolError(`"${key}" deve ser um número.`);
  return v;
}

function ids(args: Record<string, unknown>, min: number): string[] {
  const v = args.ids;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ToolError(`"ids" deve ser uma lista de ids.`);
  const list = [...new Set(v as string[])];
  if (list.length < min) throw new ToolError(`Informe ao menos ${min} id${min > 1 ? "s diferentes" : ""} em "ids".`);
  return list;
}

/** Caminho relativo ao projeto ("a/b"), sem ".." nem barra inicial. */
function relPath(args: Record<string, unknown>, key: string): string | undefined {
  const raw = str(args, key, 1000);
  if (raw === undefined) return undefined;
  const p = raw.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
  if (p.split("/").includes("..") || /^[a-z]:/i.test(p)) {
    throw new ToolError(`"${key}" deve ser relativo ao projeto, sem "..".`);
  }
  return p;
}

/** Nome mostrado de uma janela. */
function titleOf(n: CanvasNodeData): string {
  switch (n.type) {
    case "terminal":
    case "note":
    case "board":
    case "script":
      return n.title;
    case "text":
      return clip(n.text.split("\n").find((l) => l.trim())?.trim() ?? "", 60) || "Texto";
    case "image":
      return "Imagem";
    case "attachment":
      return n.title || n.name;
    case "folder":
      return n.dir || "(raiz do projeto)";
    case "portal":
      return n.file || n.url || "Portal";
  }
}

/** Resumo de uma janela (canvas_list / canvas_selection). */
function summary(n: CanvasNodeData, terminalId: string) {
  const base: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    title: titleOf(n),
    x: round(n.x),
    y: round(n.y),
    w: round(n.w),
    h: round(n.h),
  };
  if (n.group) base.group = n.group;
  switch (n.type) {
    case "terminal":
      base.agent = AGENTS[n.agent].title;
      if (n.id === terminalId) base.isSelf = true;
      break;
    case "note":
    case "text":
      base.preview = clip(n.text);
      break;
    case "script":
      base.command = clip(n.command);
      base.approved = n.approved;
      break;
    case "portal":
      if (n.file) base.file = n.file;
      else base.url = n.url;
      break;
    case "attachment":
      base.kind = attachmentKind(n.name);
      break;
  }
  return base;
}

/** Conteúdo completo (canvas_get). */
function detail(n: CanvasNodeData, terminalId: string) {
  const out = summary(n, terminalId);
  delete out.preview;
  switch (n.type) {
    case "note":
      Object.assign(out, { text: n.text, color: n.color, fontSize: n.fontSize });
      break;
    case "text":
      Object.assign(out, { text: n.text, color: n.color, fontSize: n.size, weight: n.weight, family: n.family });
      break;
    case "image":
      out.path = `.logstudio/imagens/${n.file}`;
      break;
    case "attachment":
      Object.assign(out, { name: n.name, size: n.size, path: `.logstudio/anexos/${n.file}` });
      break;
    case "folder":
      Object.assign(out, { dir: n.dir || "", openFile: n.openFile });
      break;
    case "script":
      Object.assign(out, { command: n.command, approved: n.approved, expanded: n.expanded });
      break;
    case "board":
      out.path = boardPath(n.id);
      out.note = "Desenho do Excalidraw em JSON (o arquivo só existe depois que algo for desenhado).";
      break;
  }
  return out;
}

// ---------------- Quadro: descrição simples → "skeleton" do Excalidraw ----------------

const SHAPES = ["rectangle", "ellipse", "diamond"];
const EL_TYPES = [...SHAPES, "text", "arrow", "line"];
const EL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_ELEMENTS = 300;
/** Ids de elementos que já estão no quadro (gerados pelo Excalidraw ou por nós). */
const EXT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Aviso no resultado quando setas ficaram entre formas sobrepostas (o layout precisa de ajuste). */
function overlapWarning(arrows: string[]) {
  return arrows.length
    ? {
        warning: `As setas ${arrows.map((a) => `"${a}"`).join(", ")} ligam formas que se sobrepõem (a seta fica curta ou escondida). Afaste as formas com board_move ou board_update.`,
      }
    : {};
}

/** Valida os elementos do agente e monta os "skeletons". Ids ganham um sufixo único (devolve o mapa). */
function toSkeletons(raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) throw new ToolError(`"elements" deve ser uma lista com ao menos 1 elemento.`);
  if (raw.length > MAX_ELEMENTS) throw new ToolError(`No máximo ${MAX_ELEMENTS} elementos por chamada.`);
  const suffix = Math.random().toString(36).slice(2, 8);
  const idMap: Record<string, string> = {};
  const els = raw.map((r, i) => {
    if (!r || typeof r !== "object") throw new ToolError(`elements[${i}] deve ser um objeto.`);
    const e = r as Record<string, unknown>;
    const where = `elements[${i}]`;
    const type = e.type;
    if (typeof type !== "string" || !EL_TYPES.includes(type)) {
      throw new ToolError(`${where}.type deve ser ${EL_TYPES.join(", ")}.`);
    }
    if (e.id !== undefined) {
      if (typeof e.id !== "string" || !EL_ID.test(e.id)) throw new ToolError(`${where}.id: use letras, números, - ou _.`);
      if (idMap[e.id]) throw new ToolError(`Id repetido: "${e.id}".`);
      idMap[e.id] = `${e.id}-${suffix}`;
    }
    for (const k of ["x", "y", "width", "height", "fontSize"]) {
      if (e[k] !== undefined && !isNum(e[k])) throw new ToolError(`${where}.${k} deve ser um número.`);
    }
    for (const k of ["strokeColor", "backgroundColor"]) {
      if (e[k] !== undefined && (typeof e[k] !== "string" || !(HEX.test(e[k] as string) || e[k] === "transparent"))) {
        throw new ToolError(`${where}.${k} deve ser #rrggbb.`);
      }
    }
    if (e.text !== undefined && (typeof e.text !== "string" || e.text.length > 5000)) {
      throw new ToolError(`${where}.text deve ser texto (até 5000 caracteres).`);
    }
    return e;
  });

  const byId = new Map(els.filter((e) => typeof e.id === "string").map((e) => [e.id as string, e]));
  const links: { arrowId: string; from?: string; to?: string }[] = [];
  const center = (e: Record<string, unknown>) => ({
    x: ((e.x as number) ?? 0) + ((e.width as number) ?? 160) / 2,
    y: ((e.y as number) ?? 0) + ((e.height as number) ?? 80) / 2,
  });

  const skeletons = els.map((e, i) => {
    const where = `elements[${i}]`;
    const type = e.type as string;
    const id = typeof e.id === "string" ? idMap[e.id] : `el-${i}-${suffix}`;
    const common = {
      id,
      ...(e.strokeColor ? { strokeColor: e.strokeColor } : {}),
    };
    const fontSize = (e.fontSize as number | undefined) ?? 20;

    if (SHAPES.includes(type)) {
      return {
        ...common,
        type,
        x: (e.x as number) ?? 0,
        y: (e.y as number) ?? 0,
        width: Math.max(10, (e.width as number) ?? 160),
        height: Math.max(10, (e.height as number) ?? 80),
        ...(e.backgroundColor ? { backgroundColor: e.backgroundColor, fillStyle: "solid" } : {}),
        ...(e.text ? { label: { text: e.text, fontSize } } : {}),
      };
    }
    if (type === "text") {
      if (!e.text) throw new ToolError(`${where}: type "text" precisa de "text".`);
      return { ...common, type, x: (e.x as number) ?? 0, y: (e.y as number) ?? 0, text: e.text, fontSize };
    }

    // Seta / linha
    const label = type === "arrow" && e.text ? { label: { text: e.text, fontSize: Math.min(fontSize, 18) } } : {};
    if (e.from !== undefined || e.to !== undefined) {
      if (type !== "arrow") throw new ToolError(`${where}: só "arrow" liga formas (from/to).`);
      for (const k of ["from", "to"] as const) {
        if (e[k] !== undefined && (typeof e[k] !== "string" || !EXT_ID.test(e[k] as string))) {
          throw new ToolError(`${where}.${k} deve ser o id de uma forma.`);
        }
      }
      // Da mesma chamada: ligada na conversão. Senão: forma que já está no quadro (ligada depois).
      const from = e.from !== undefined ? byId.get(e.from as string) : undefined;
      const to = e.to !== undefined ? byId.get(e.to as string) : undefined;
      const extFrom = e.from !== undefined && !from ? (e.from as string) : undefined;
      const extTo = e.to !== undefined && !to ? (e.to as string) : undefined;
      if (extFrom || extTo) links.push({ arrowId: id, ...(extFrom ? { from: extFrom } : {}), ...(extTo ? { to: extTo } : {}) });
      // Posição provisória: a geometria real (borda a borda) é refeita depois de ligar.
      const a = from ? center(from) : { x: 0, y: 0 };
      const b = to ? center(to) : { x: a.x + 100, y: a.y };
      return {
        ...common,
        type,
        x: a.x,
        y: a.y,
        width: b.x - a.x || 1,
        height: b.y - a.y || 1,
        ...(from ? { start: { id: idMap[from.id as string] } } : {}),
        ...(to ? { end: { id: idMap[to.id as string] } } : {}),
        ...label,
      };
    }
    if (!isNum(e.x) || !isNum(e.y) || (!isNum(e.width) && !isNum(e.height))) {
      throw new ToolError(`${where}: seta/linha sem from/to precisa de x, y e width/height (até a ponta).`);
    }
    const w = (e.width as number) ?? 0;
    const h = (e.height as number) ?? 0;
    return { ...common, type, x: e.x, y: e.y, width: w, height: h, points: [[0, 0], [w, h]], ...label };
  });
  return { skeletons, idMap, links };
}

function boxesOverlap(a: { x: number; y: number; w: number; h: number }, b: CanvasNodeData) {
  return a.x < b.x + b.w + GAP / 2 && a.x + a.w + GAP / 2 > b.x && a.y < b.y + b.h + GAP / 2 && a.y + a.h + GAP / 2 > b.y;
}

/** Lugar livre ao lado do terminal do agente (desce e depois abre nova coluna). */
export function autoPlace(nodes: CanvasNodeData[], terminalId: string, w: number, h: number) {
  const term = nodes.find((n) => n.id === terminalId);
  const startX = term ? term.x + term.w + GAP : nodes.length ? Math.max(...nodes.map((n) => n.x + n.w)) + GAP : 0;
  const startY = term ? term.y : 0;
  let x = startX;
  let y = startY;
  for (let i = 0; i < 200; i++) {
    const hit = nodes.find((n) => boxesOverlap({ x, y, w, h }, n));
    if (!hit) return { x, y };
    y = hit.y + hit.h + GAP;
    if (y - startY > 2400) {
      x += w + GAP;
      y = startY;
    }
  }
  return { x, y };
}

/** Posição pedida (x e y) ou um lugar livre. */
function place(ctx: ToolContext, args: Record<string, unknown>, w: number, h: number) {
  const x = num(args, "x");
  const y = num(args, "y");
  if (x !== undefined && y !== undefined) return { x, y };
  return autoPlace(ctx.getNodes(), ctx.terminalId, w, h);
}

function find(nodes: CanvasNodeData[], id: string | undefined) {
  if (!id) throw new ToolError(`Informe "id" (veja canvas_list).`);
  const n = nodes.find((node) => node.id === id);
  if (!n) throw new ToolError(`Janela "${id}" não existe neste canvas (veja canvas_list).`);
  return n;
}

/** Janela Quadro pelo `id` dos argumentos. */
function boardNode(nodes: CanvasNodeData[], args: Record<string, unknown>): BoardNodeData {
  const n = find(nodes, str(args, "id", 200));
  if (n.type !== "board") throw new ToolError(`A janela "${n.id}" não é um Quadro (é "${n.type}").`);
  return n;
}

/** Janela Script pelo `id` dos argumentos. */
function scriptNode(nodes: CanvasNodeData[], args: Record<string, unknown>): ScriptNodeData {
  const n = find(nodes, str(args, "id", 200));
  if (n.type !== "script") throw new ToolError(`A janela "${n.id}" não é um Script (é "${n.type}").`);
  return n;
}

/** Campos que update_window aceita em cada tipo. */
const UPDATABLE: Record<CanvasNodeData["type"], string[]> = {
  note: ["title", "text", "color", "fontSize", "x", "y", "w", "h"],
  text: ["text", "color", "fontSize", "x", "y"],
  terminal: ["title", "x", "y", "w", "h"],
  script: ["title", "command", "x", "y", "w"],
  board: ["title", "x", "y", "w", "h"],
  portal: ["url", "file", "x", "y", "w", "h"],
  folder: ["x", "y", "w", "h"],
  attachment: ["title", "x", "y", "w", "h"],
  image: ["x", "y", "w"],
};

const FILE_HELP = `"file" inválido: caminho relativo ao projeto terminando em .html ou .htm (ex.: "site/index.html"), sem ".." nem caminho absoluto.`;

function updatePatch(n: CanvasNodeData, args: Record<string, unknown>): NodePatch {
  const fields = Object.keys(args).filter((k) => k !== "id");
  if (!fields.length) throw new ToolError("Nada para alterar: informe ao menos um campo.");
  const allowed = UPDATABLE[n.type];
  const bad = fields.filter((f) => !allowed.includes(f));
  if (bad.length) {
    throw new ToolError(`Uma janela "${n.type}" não aceita: ${bad.join(", ")}. Aceita: ${allowed.join(", ")}.`);
  }
  const patch: NodePatch = {};
  const min = minSize(n.type);
  const x = num(args, "x");
  const y = num(args, "y");
  const w = num(args, "w");
  const h = num(args, "h");
  if (x !== undefined) patch.x = x;
  if (y !== undefined) patch.y = y;
  if (n.type === "image") {
    if (w !== undefined) {
      const nw = Math.max(min.w, w);
      Object.assign(patch, { w: nw, h: (nw * n.h) / n.w });
    }
  } else {
    if (w !== undefined) patch.w = Math.max(min.w, w);
    if (h !== undefined) patch.h = Math.max(min.h, h);
  }

  const command = str(args, "command", SCRIPT_MAX);
  if (command !== undefined && n.type === "script") {
    if (!command.trim()) throw new ToolError(`"command" não pode ficar vazio.`);
    patch.command = command.trim();
    // Comando mudado por agente: o usuário precisa aprovar de novo.
    if (patch.command !== n.command) patch.approved = false;
  }

  const title = str(args, "title", 200);
  if (title !== undefined) {
    if (!title.trim()) throw new ToolError(`"title" não pode ficar vazio.`);
    patch.title = title.trim();
  }
  const text = str(args, "text");
  if (text !== undefined) patch.text = text;

  const color = str(args, "color", 20);
  if (color !== undefined) {
    if (n.type === "text" ? !/^#[0-9a-f]{6}$/i.test(color) : !isNoteColor(color)) {
      throw new ToolError(n.type === "text" ? `"color" de texto deve ser #rrggbb.` : `"color" inválida: ${COLOR_HELP}.`);
    }
    patch.color = color;
  }

  const fontSize = num(args, "fontSize");
  if (fontSize !== undefined) {
    if (n.type === "text") patch.size = Math.round(Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, fontSize)));
    else patch.fontSize = Math.round(Math.min(NOTE_FONT_MAX, Math.max(NOTE_FONT_MIN, fontSize)));
  }

  const url = str(args, "url", 4000);
  const file = str(args, "file", 1000);
  if (url !== undefined && file !== undefined) throw new ToolError(`Informe "url" ou "file", não os dois.`);
  if (file !== undefined) {
    const normalized = normalizePortalFile(file);
    if (!normalized) throw new ToolError(FILE_HELP);
    Object.assign(patch, { url: "", file: normalized });
  }
  if (url !== undefined) {
    const normalized = normalizeUrl(url);
    if (!normalized) throw new ToolError(`"url" inválida (use http ou https).`);
    Object.assign(patch, { url: normalized, file: undefined });
  }
  return patch;
}

/** Cria uma janela: devolve o resumo, a inclusão na lista e a descrição. */
function created(node: CanvasNodeData, terminalId: string, log: string): ToolOutcome {
  return { result: summary(node, terminalId), apply: (list) => [...list, node], log };
}

/** Executa uma ferramenta do agente. Lança ToolError com a mensagem para ele. */
export async function runTool(
  tool: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  deps: ToolDeps,
): Promise<ToolOutcome> {
  const { terminalId } = ctx;
  const nodes = ctx.getNodes();
  switch (tool) {
    // ---------------- Ler ----------------
    case "canvas_list":
      return { result: { count: nodes.length, windows: nodes.map((n) => summary(n, terminalId)) } };

    case "canvas_get":
      return { result: detail(find(nodes, str(args, "id", 200)), terminalId) };

    case "canvas_selection": {
      const sel = nodes.filter((n) => ctx.selectedIds.includes(n.id));
      return { result: { count: sel.length, windows: sel.map((n) => summary(n, terminalId)) } };
    }

    // ---------------- Criar ----------------
    case "create_note": {
      const text = str(args, "text");
      if (text === undefined) throw new ToolError(`Informe "text".`);
      const title = str(args, "title", 200)?.trim() || NOTE_DEFAULTS.title;
      const color = str(args, "color", 20);
      if (color !== undefined && !isNoteColor(color)) throw new ToolError(`"color" inválida: ${COLOR_HELP}.`);
      const min = minSize("note");
      const w = Math.max(min.w, num(args, "w") ?? NOTE_DEFAULT_W);
      const h = Math.max(min.h, num(args, "h") ?? NOTE_DEFAULT_H);
      const note: NoteNodeData = {
        id: crypto.randomUUID(),
        type: "note",
        ...NOTE_DEFAULTS,
        title,
        text,
        color: color ?? getLastNoteColor(),
        ...place(ctx, args, w, h),
        w,
        h,
      };
      return created(note, terminalId, `criou a nota "${title}"`);
    }

    case "create_text": {
      const text = str(args, "text");
      if (!text?.trim()) throw new ToolError(`Informe "text" (não vazio).`);
      const size = Math.round(Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, num(args, "fontSize") ?? TEXT_DEFAULTS.size)));
      const color = str(args, "color", 20) ?? TEXT_DEFAULTS.color;
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ToolError(`"color" de texto deve ser #rrggbb.`);
      const weight = str(args, "weight", 20) ?? TEXT_DEFAULTS.weight;
      if (!(weight in TEXT_WEIGHTS)) throw new ToolError(`"weight" deve ser regular, medium ou bold.`);
      const family = str(args, "family", 20) ?? TEXT_DEFAULTS.family;
      if (!(family in TEXT_FAMILIES)) throw new ToolError(`"family" deve ser sans, serif ou mono.`);
      // Tamanho estimado (o real é medido na tela depois).
      const lines = text.split("\n");
      const w = Math.max(...lines.map((l) => l.length)) * size * 0.6 + 28;
      const h = lines.length * size * 1.25 + 8;
      const node: TextNodeData = {
        id: crypto.randomUUID(),
        type: "text",
        text,
        size,
        weight: weight as TextWeight,
        family: family as TextFamily,
        color,
        ...place(ctx, args, w, h),
        w,
        h,
      };
      return created(node, terminalId, `criou o texto "${clip(text.trim(), 40)}"`);
    }

    case "create_portal": {
      const rawUrl = str(args, "url", 4000);
      const rawFile = str(args, "file", 1000);
      if ((rawUrl === undefined) === (rawFile === undefined)) throw new ToolError(`Informe "url" ou "file" (um dos dois).`);
      let target: { url: string; file?: string };
      if (rawFile !== undefined) {
        const file = normalizePortalFile(rawFile);
        if (!file) throw new ToolError(FILE_HELP);
        target = { url: "", file };
      } else {
        const url = normalizeUrl(rawUrl ?? "");
        if (!url) throw new ToolError(`"url" inválida (use http ou https, ou localhost:porta).`);
        target = { url };
      }
      const min = minSize("portal");
      const w = Math.max(min.w, num(args, "w") ?? PORTAL_DEFAULT_W);
      const h = Math.max(min.h, num(args, "h") ?? PORTAL_DEFAULT_H);
      const node: PortalNodeData = { id: crypto.randomUUID(), type: "portal", ...target, ...place(ctx, args, w, h), w, h };
      return created(node, terminalId, `abriu um portal em ${target.file ?? target.url}`);
    }

    case "create_image": {
      const source = str(args, "source", 4000);
      if (!source?.trim()) throw new ToolError(`Informe "source" (caminho ou URL).`);
      const reqW = num(args, "w");
      const file = await deps.importImage(source.trim());
      const size = await deps.imageSize(file);
      const scale = reqW !== undefined ? Math.max(minSize("image").w, reqW) / size.w : Math.min(1, IMAGE_INITIAL_MAX / Math.max(size.w, size.h));
      const w = size.w * scale;
      const h = size.h * scale;
      const node: ImageNodeData = { id: crypto.randomUUID(), type: "image", file, ...place(ctx, args, w, h), w, h };
      return created(node, terminalId, "adicionou uma imagem");
    }

    case "attach_file": {
      const source = str(args, "source", 4000);
      if (!source?.trim()) throw new ToolError(`Informe "source" (caminho ou URL).`);
      const a = await deps.attachFile(source.trim());
      const { w, h } = attachmentSize(attachmentKind(a.name));
      const node: AttachmentNodeData = {
        id: crypto.randomUUID(),
        type: "attachment",
        file: a.file,
        name: a.name,
        size: a.size,
        ...place(ctx, args, w, h),
        w,
        h,
      };
      return created(node, terminalId, `anexou "${a.name}"`);
    }

    case "create_folder": {
      const dir = relPath(args, "dir") ?? "";
      const openFile = relPath(args, "openFile") || null;
      await deps.checkDir(dir);
      const w = FOLDER_DEFAULT_W;
      const h = FOLDER_DEFAULT_H;
      const node: FolderNodeData = {
        id: crypto.randomUUID(),
        type: "folder",
        ...FOLDER_DEFAULTS,
        dir,
        openFile,
        ...place(ctx, args, w, h),
        w,
        h,
      };
      return created(node, terminalId, `abriu a pasta "${dir || "raiz do projeto"}"`);
    }

    case "create_script": {
      const command = str(args, "command", SCRIPT_MAX)?.trim();
      if (!command) throw new ToolError(`Informe "command" (comando do PowerShell).`);
      const title = str(args, "title", 200)?.trim() || SCRIPT_DEFAULT_TITLE;
      const w = SCRIPT_DEFAULT_W;
      const node: ScriptNodeData = {
        id: crypto.randomUUID(),
        type: "script",
        title,
        command,
        approved: false, // definido por agente: o usuário aprova antes da 1ª execução
        expanded: false,
        openH: SCRIPT_DEFAULT_OPEN_H,
        ...place(ctx, args, w, SCRIPT_COLLAPSED_H),
        w,
        h: SCRIPT_COLLAPSED_H,
      };
      const out = created(node, terminalId, `criou o script "${title}"`);
      return {
        ...out,
        result: {
          ...(out.result as object),
          note: "O script NÃO foi executado. O usuário precisa clicar em \"Aprovar e executar\" na janela; depois disso use run_script.",
        },
      };
    }

    case "run_script": {
      const n = scriptNode(nodes, args);
      const action = str(args, "action", 20);
      if (action !== "start" && action !== "stop" && action !== "restart") {
        throw new ToolError(`"action" deve ser start, stop ou restart.`);
      }
      if (action === "stop") {
        const state = deps.stopScript(n);
        return { result: { id: n.id, ...state }, log: `parou o script "${n.title}"`, touched: [n.id] };
      }
      if (!n.command.trim()) throw new ToolError(`O script "${n.title}" não tem comando. Defina com update_window.`);
      if (!n.approved) {
        throw new ToolError(
          `O comando do script "${n.title}" ainda não foi aprovado. Peça ao usuário para clicar em "Aprovar e executar" na janela.`,
        );
      }
      if (action === "start" && deps.scriptState(n.id).status === "running") {
        return { result: { id: n.id, ...deps.scriptState(n.id), note: "Já estava rodando." } };
      }
      const state = deps.runScript(n);
      return {
        result: { id: n.id, ...state },
        log: `${action === "restart" ? "reiniciou" : "iniciou"} o script "${n.title}"`,
        touched: [n.id],
      };
    }

    case "script_logs": {
      const n = scriptNode(nodes, args);
      const lines = Math.round(Math.min(1000, Math.max(1, num(args, "lines") ?? 100)));
      const state = deps.scriptState(n.id);
      return {
        result: {
          id: n.id,
          title: n.title,
          command: n.command,
          approved: n.approved,
          ...state,
          output: deps.scriptLines(n.id, lines).join("\n"),
        },
      };
    }

    case "create_board": {
      const title = str(args, "title", 200)?.trim() || BOARD_DEFAULT_TITLE;
      const min = minSize("board");
      const w = Math.max(min.w, num(args, "w") ?? BOARD_DEFAULT_W);
      const h = Math.max(min.h, num(args, "h") ?? BOARD_DEFAULT_H);
      const node: BoardNodeData = { id: crypto.randomUUID(), type: "board", title, ...place(ctx, args, w, h), w, h };
      return created(node, terminalId, `criou o quadro "${title}"`);
    }

    case "board_draw": {
      const n = boardNode(nodes, args);
      if (args.clear !== undefined && typeof args.clear !== "boolean") throw new ToolError(`"clear" deve ser true ou false.`);
      const { skeletons, idMap, links } = toSkeletons(args.elements);
      if (args.clear === true && links.length) {
        throw new ToolError(`Com "clear": true não dá para ligar setas a formas que já estavam no quadro (elas serão apagadas).`);
      }
      const { added, overlapping, revert } = await deps.drawOnBoard(n.id, skeletons, args.clear === true, links);
      return {
        result: { board: n.id, added, ids: idMap, ...overlapWarning(overlapping) },
        log: `${args.clear ? "redesenhou" : "desenhou"} ${added} elemento${added === 1 ? "" : "s"} em "${n.title}"`,
        touched: [n.id],
        revert,
      };
    }

    case "board_snapshot": {
      const n = boardNode(nodes, args);
      const { png, elements } = await deps.snapshotBoard(n.id);
      return {
        result: {
          __content: [
            { type: "image", data: png, mimeType: "image/png" },
            { type: "text", text: JSON.stringify({ board: n.id, title: n.title, elements }, null, 2) },
          ],
        },
      };
    }

    case "board_update": {
      const n = boardNode(nodes, args);
      const raw = args.elements;
      if (!Array.isArray(raw) || raw.length === 0) throw new ToolError(`"elements" deve ser uma lista com ao menos 1 item.`);
      if (raw.length > MAX_ELEMENTS) throw new ToolError(`No máximo ${MAX_ELEMENTS} itens por chamada.`);
      const patches: BoardPatch[] = raw.map((r, i) => {
        const where = `elements[${i}]`;
        if (!r || typeof r !== "object") throw new ToolError(`${where} deve ser um objeto.`);
        const e = r as Record<string, unknown>;
        if (typeof e.id !== "string" || !e.id) throw new ToolError(`${where}.id é obrigatório.`);
        const patch: BoardPatch = { id: e.id };
        for (const k of ["x", "y", "width", "height", "fontSize"] as const) {
          if (e[k] === undefined) continue;
          if (!isNum(e[k])) throw new ToolError(`${where}.${k} deve ser um número.`);
          patch[k] = e[k] as number;
        }
        if (patch.fontSize !== undefined) patch.fontSize = Math.min(200, Math.max(6, patch.fontSize));
        for (const k of ["strokeColor", "backgroundColor"] as const) {
          if (e[k] === undefined) continue;
          if (typeof e[k] !== "string" || !(HEX.test(e[k] as string) || e[k] === "transparent")) {
            throw new ToolError(`${where}.${k} deve ser #rrggbb.`);
          }
          patch[k] = e[k] as string;
        }
        if (e.text !== undefined) {
          if (typeof e.text !== "string" || e.text.length > 5000) throw new ToolError(`${where}.text deve ser texto (até 5000).`);
          patch.text = e.text;
        }
        if (e.points !== undefined) {
          const pts = e.points;
          const ok =
            Array.isArray(pts) &&
            pts.length >= 2 &&
            pts.length <= 100 &&
            pts.every((q) => Array.isArray(q) && q.length === 2 && isNum(q[0]) && isNum(q[1]));
          if (!ok) throw new ToolError(`${where}.points deve ser uma lista de 2 a 100 pares [x, y].`);
          patch.points = pts as [number, number][];
        }
        if (Object.keys(patch).length === 1) throw new ToolError(`${where}: nada para alterar.`);
        return patch;
      });
      const { changed, missing, revert } = await deps.updateBoard(n.id, patches);
      if (!changed.length) {
        throw new ToolError(`Nenhum elemento encontrado: ${missing.join(", ")}. Veja os ids com board_snapshot (textos dentro de formas se alteram pela forma).`);
      }
      return {
        result: { board: n.id, changed: changed.length, ...(missing.length ? { notFound: missing } : {}) },
        log: `ajustou ${patches.length - missing.length} elemento${patches.length - missing.length === 1 ? "" : "s"} em "${n.title}"`,
        touched: [n.id],
        revert,
      };
    }

    case "board_move": {
      const n = boardNode(nodes, args);
      const dx = num(args, "dx") ?? 0;
      const dy = num(args, "dy") ?? 0;
      if (dx === 0 && dy === 0) throw new ToolError(`Informe "dx" e/ou "dy" (diferentes de 0).`);
      const belowY = num(args, "belowY");
      const list = args.ids === undefined ? undefined : ids(args, 1);
      if (!list && belowY === undefined) throw new ToolError(`Informe "ids" e/ou "belowY".`);
      const { moved, missing, overlapping, revert } = await deps.moveOnBoard(n.id, { ids: list, belowY }, dx, dy);
      if (!moved.length) throw new ToolError(`Nada para mover. Veja os ids/posições com board_snapshot.`);
      return {
        result: {
          board: n.id,
          moved: moved.length,
          ...(missing.length ? { notFound: missing } : {}),
          ...overlapWarning(overlapping),
        },
        log: `moveu ${moved.length} elemento${moved.length === 1 ? "" : "s"} em "${n.title}"`,
        touched: [n.id],
        revert,
      };
    }

    case "board_remove": {
      const n = boardNode(nodes, args);
      const list = ids(args, 1);
      const { removed, found, revert } = await deps.removeFromBoard(n.id, list);
      if (!found.length) throw new ToolError(`Nenhum desses ids existe no quadro. Veja os ids com board_snapshot.`);
      const missing = list.filter((id) => !found.includes(id));
      return {
        result: { board: n.id, removed, ...(missing.length ? { notFound: missing } : {}) },
        log: `removeu ${found.length} elemento${found.length === 1 ? "" : "s"} de "${n.title}"`,
        touched: [n.id],
        revert,
      };
    }

    // ---------------- Modificar ----------------
    case "update_window": {
      const n = find(nodes, str(args, "id", 200));
      const patch = updatePatch(n, args);
      const fields = Object.keys(args).filter((k) => k !== "id");
      return {
        result: detail({ ...n, ...patch } as CanvasNodeData, terminalId),
        apply: (list) => list.map((m) => (m.id === n.id ? ({ ...m, ...patch } as CanvasNodeData) : m)),
        log: `alterou ${fields.join(", ")} de "${titleOf(n)}"`,
      };
    }

    case "connect": {
      const list = ids(args, 2).map((id) => find(nodes, id));
      const oldGroups = new Set(list.map((n) => n.group).filter(Boolean));
      const chosen = new Set(list.map((n) => n.id));
      const group = crypto.randomUUID();
      const joins = (n: CanvasNodeData) => chosen.has(n.id) || (!!n.group && oldGroups.has(n.group));
      const members = nodes.filter(joins).map((n) => n.id);
      return {
        result: { group, members },
        apply: (all) => all.map((n) => (joins(n) ? ({ ...n, group } as CanvasNodeData) : n)),
        log: `conectou ${members.length} janelas`,
      };
    }

    case "disconnect": {
      const chosen = new Set(ids(args, 1).map((id) => find(nodes, id).id));
      return {
        result: { disconnected: [...chosen] },
        log: `desconectou ${chosen.size} janela${chosen.size > 1 ? "s" : ""}`,
        apply: (all) =>
          normalizeGroups(
            all.map((n) => {
              if (!chosen.has(n.id) || !n.group) return n;
              const { group: _drop, ...rest } = n;
              return rest as CanvasNodeData;
            }),
          ),
      };
    }

    case "focus_window": {
      const n = find(nodes, str(args, "id", 200));
      deps.focus(n);
      return { result: { focused: n.id }, log: `centralizou em "${titleOf(n)}"`, touched: [n.id] };
    }

    case "delete_window": {
      const n = find(nodes, str(args, "id", 200));
      if (n.id === terminalId) throw new ToolError("Você não pode excluir o seu próprio terminal.");
      const ok = await deps.confirmDelete(n);
      if (!ok) throw new ToolError("O usuário recusou a exclusão.");
      const still = ctx.getNodes().find((m) => m.id === n.id);
      if (!still) throw new ToolError("A janela já não existe.");
      deps.deleteNode(still);
      return { result: { deleted: n.id }, log: `excluiu "${titleOf(n)}"` };
    }

    default:
      throw new ToolError(`Ferramenta desconhecida: ${tool}`);
  }
}
