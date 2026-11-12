// Cards do canvas de um projeto: terminais e notas.
// Posição e tamanho em coordenadas do "mundo" (independentes do zoom).

export type AgentKind = "shell" | "claude" | "codex";

export interface TerminalNodeData {
  id: string;
  type: "terminal";
  /** Janelas conectadas compartilham o mesmo id de grupo (movem juntas). */
  group?: string;
  agent: AgentKind;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NoteColor =
  | "yellow" | "pink" | "blue" | "green" | "orange"
  | "purple" | "white" | "black" | "slate" | "navy" | "gray";

export interface NoteNodeData {
  id: string;
  type: "note";
  /** Janelas conectadas compartilham o mesmo id de grupo (movem juntas). */
  group?: string;
  /** Nome no cabeçalho. */
  title: string;
  /** Texto em Markdown. */
  text: string;
  /** Chave da paleta ou "#rrggbb". */
  color: string;
  fontSize: number;
  /** Nome da fonte; "" = padrão (monoespaçada). */
  font: string;
  /** true = mostra o Markdown formatado; false = editando o texto. */
  preview: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Imagem colada/arrastada; o arquivo fica em `<projeto>/.logstudio/imagens/`. */
export interface ImageNodeData {
  id: string;
  type: "image";
  /** Janelas conectadas compartilham o mesmo id de grupo (movem juntas). */
  group?: string;
  /** Nome do arquivo (sem caminho). */
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextWeight = "regular" | "medium" | "bold";
export type TextFamily = "sans" | "serif" | "mono";

/** Texto solto no canvas (sem fundo; a largura acompanha o conteúdo). */
export interface TextNodeData {
  id: string;
  type: "text";
  /** Janelas conectadas compartilham o mesmo id de grupo (movem juntas). */
  group?: string;
  text: string;
  /** Tamanho da fonte (a 100% de zoom). */
  size: number;
  weight: TextWeight;
  family: TextFamily;
  /** "#rrggbb" */
  color: string;
  x: number;
  y: number;
  /** Tamanho medido na tela (vem do conteúdo; usado para seleção, grupo e centralizar). */
  w: number;
  h: number;
}

export type FolderSort = "name" | "modified" | "size";
export type TabSize = 2 | 4 | 8;

/** Navegador de arquivos do projeto + editor ("Pasta"). Caminhos relativos ao projeto, com "/". */
export interface FolderNodeData {
  id: string;
  type: "folder";
  /** Janelas conectadas compartilham o mesmo id de grupo (movem juntas). */
  group?: string;
  /** Pasta mostrada na lista ("" = raiz do projeto). */
  dir: string;
  /** Arquivo aberto no editor. */
  openFile: string | null;
  /** Lista de arquivos visível. */
  sidebar: boolean;
  sort: FolderSort;
  /** Fonte do editor ("" = padrão, Cascadia Mono). */
  font: string;
  fontSize: number;
  tabSize: TabSize;
  wrap: boolean;
  markdown: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Página web dentro do canvas (iframe). */
export interface PortalNodeData {
  id: string;
  type: "portal";
  /** Janelas conectadas compartilham o mesmo id de grupo (movem juntas). */
  group?: string;
  /** Endereço http(s) ("" = ainda não navegou). */
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Anexo: qualquer arquivo copiado para `<projeto>/.logstudio/anexos/`. */
export interface AttachmentNodeData {
  id: string;
  type: "attachment";
  /** Janelas conectadas compartilham o mesmo id de grupo (movem juntas). */
  group?: string;
  /** Nome do arquivo salvo em anexos/ (gerado). */
  file: string;
  /** Nome original (mostrado). */
  name: string;
  /** Tamanho em bytes. */
  size: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Quadro de desenho (Excalidraw) dentro de uma janela. */
export interface BoardNodeData {
  id: string;
  type: "board";
  /** Janelas conectadas compartilham o mesmo id de grupo (movem juntas). */
  group?: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CanvasNodeData =
  | BoardNodeData
  | AttachmentNodeData
  | TerminalNodeData
  | NoteNodeData
  | ImageNodeData
  | TextNodeData
  | FolderNodeData
  | PortalNodeData;

/** Campos que podem ser alterados num card (posição, tamanho, título, texto). */
export type NodePatch = Partial<Omit<TerminalNodeData, "id" | "type">> &
  Partial<Omit<NoteNodeData, "id" | "type">> &
  Partial<Omit<ImageNodeData, "id" | "type">> &
  Partial<Omit<TextNodeData, "id" | "type">> &
  Partial<Omit<FolderNodeData, "id" | "type">> &
  Partial<Omit<PortalNodeData, "id" | "type">> &
  Partial<Omit<AttachmentNodeData, "id" | "type">> &
  Partial<Omit<BoardNodeData, "id" | "type">>;

export const AGENTS: Record<AgentKind, { title: string; color: string }> = {
  shell: { title: "PowerShell", color: "#9a9a9e" },
  claude: { title: "Claude Code", color: "#e07a55" },
  codex: { title: "Codex", color: "#3fa37a" },
};

// Terminal
export const NODE_MIN_W = 320;
export const NODE_MIN_H = 200;
export const NODE_DEFAULT_W = 720;
export const NODE_DEFAULT_H = 460;

// Nota
/** Paleta da nota (ordem do seletor). "gray" é de versões antigas e não aparece no seletor. */
export const NOTE_COLORS: Record<NoteColor, { label: string; bg: string; band: string; text: string }> = {
  yellow: { label: "Amarelo", bg: "#fff8c5", band: "#efe8b8", text: "#5b4636" },
  pink: { label: "Rosa", bg: "#f9c6d3", band: "#ecb5c3", text: "#6b3a42" },
  blue: { label: "Azul", bg: "#c9e1fb", band: "#b7d2ef", text: "#1e3a5f" },
  green: { label: "Verde", bg: "#cde8cf", band: "#bbdabe", text: "#1f4d33" },
  orange: { label: "Laranja", bg: "#fcdcae", band: "#efcd9b", text: "#6b4320" },
  purple: { label: "Lilás", bg: "#e3c8ea", band: "#d4b6dc", text: "#4b2f57" },
  white: { label: "Branco", bg: "#ffffff", band: "#efefef", text: "#333333" },
  black: { label: "Preto", bg: "#232325", band: "#2e2e31", text: "#ececec" },
  slate: { label: "Ardósia", bg: "#34454e", band: "#3e5059", text: "#e8eef1" },
  navy: { label: "Azul-marinho", bg: "#1f2b78", band: "#293686", text: "#e8ebff" },
  gray: { label: "Cinza", bg: "#f1f1f1", band: "#e2e2e2", text: "#333333" },
};
export const NOTE_PALETTE: NoteColor[] = [
  "yellow", "pink", "blue", "green", "orange",
  "purple", "white", "black", "slate", "navy",
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Cor válida: chave da paleta ou "#rrggbb" (cor livre). */
export function isNoteColor(c: unknown): c is string {
  return typeof c === "string" && (c in NOTE_COLORS || HEX.test(c));
}

const LAST_COLOR_KEY = "logstudio.lastNoteColor";

/** Cor das novas notas: a última escolhida no seletor (amarelo se não houver). */
export function getLastNoteColor(): string {
  try {
    const c = localStorage.getItem(LAST_COLOR_KEY);
    if (isNoteColor(c)) return c;
  } catch {
    /* armazenamento indisponível */
  }
  return NOTE_DEFAULTS.color;
}

export function setLastNoteColor(color: string) {
  try {
    localStorage.setItem(LAST_COLOR_KEY, color);
  } catch {
    /* armazenamento indisponível */
  }
}

/** Fundo, faixa e texto de uma cor (paleta ou livre, com contraste automático). */
export function noteTheme(color: string): { bg: string; band: string; text: string } {
  if (color in NOTE_COLORS) return NOTE_COLORS[color as NoteColor];
  if (!HEX.test(color)) return NOTE_COLORS.yellow;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const dark = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.25;
  return {
    bg: color,
    band: `color-mix(in srgb, ${color}, ${dark ? "#fff 9%" : "#000 7%"})`,
    text: dark ? "#f2f2f2" : "#2b2b2b",
  };
}

export const NOTE_FONT_MIN = 8;
export const NOTE_FONT_MAX = 48;
export const NOTE_DEFAULTS = { title: "Nota", color: "yellow" as string, fontSize: 16, font: "", preview: false };
/** Fontes sugeridas no seletor (as instaladas aparecem em "Todas as fontes"). */
export const SUGGESTED_FONTS = [
  "Consolas",
  "Cascadia Code",
  "Cascadia Mono",
  "Courier New",
  "Georgia",
  "Times New Roman",
  "Segoe UI",
  "Arial",
];
const MONO_STACK = '"Cascadia Mono", Consolas, monospace';

/** CSS font-family de uma nota ("" = padrão monoespaçada). */
export function noteFontFamily(font: string) {
  const name = font.replace(/["\\]/g, "").trim();
  return name ? `"${name}", ${MONO_STACK}` : MONO_STACK;
}
export const NOTE_MIN_W = 160;
export const NOTE_MIN_H = 100;
export const NOTE_DEFAULT_W = 280;
export const NOTE_DEFAULT_H = 220;
const NOTE_MAX_TEXT = 50_000;

// Imagem
export const IMAGE_MIN = 40;
/** Maior lado de uma imagem nova (a 100% de zoom). */
export const IMAGE_INITIAL_MAX = 480;
const IMAGE_FILE = /^[A-Za-z0-9_-]{1,64}\.(png|jpg|gif|webp|bmp)$/;

// Pasta
export const FOLDER_MIN_W = 480;
export const FOLDER_MIN_H = 300;
export const FOLDER_DEFAULT_W = 900;
export const FOLDER_DEFAULT_H = 520;
export const FOLDER_FONT_MIN = 8;
export const FOLDER_FONT_MAX = 32;
export const FOLDER_DEFAULTS = {
  dir: "",
  openFile: null as string | null,
  sidebar: true,
  sort: "name" as FolderSort,
  font: "",
  fontSize: 13,
  tabSize: 4 as TabSize,
  wrap: false,
  markdown: true,
};
const relPath = (v: unknown, fallback: string) =>
  typeof v === "string" && v.length <= 1000 && !v.split("/").includes("..") ? v : fallback;

// Anexo
export const ATTACHMENT_MIN_W = 220;
export const ATTACHMENT_MIN_H = 110;
const ATTACHMENT_FILE = /^[A-Za-z0-9_-]{1,64}(\.[A-Za-z0-9]{1,10})?$/;

// Portal
export const PORTAL_MIN_W = 360;
export const PORTAL_MIN_H = 240;
export const PORTAL_DEFAULT_W = 1000;
export const PORTAL_DEFAULT_H = 640;

// Quadro (Excalidraw)
export const BOARD_MIN_W = 360;
export const BOARD_MIN_H = 260;
export const BOARD_DEFAULT_W = 900;
export const BOARD_DEFAULT_H = 600;
export const BOARD_DEFAULT_TITLE = "Quadro";

/** Tira o grupo de quem ficou sozinho nele. */
export function normalizeGroups(list: CanvasNodeData[]): CanvasNodeData[] {
  const count = new Map<string, number>();
  for (const n of list) if (n.group) count.set(n.group, (count.get(n.group) ?? 0) + 1);
  return list.map((n) => {
    if (!n.group || (count.get(n.group) ?? 0) > 1) return n;
    const { group: _drop, ...rest } = n;
    return rest as CanvasNodeData;
  });
}

/** Tamanho mínimo de cada tipo de card. */
export function minSize(type: CanvasNodeData["type"]) {
  if (type === "board") return { w: BOARD_MIN_W, h: BOARD_MIN_H };
  if (type === "portal") return { w: PORTAL_MIN_W, h: PORTAL_MIN_H };
  if (type === "attachment") return { w: ATTACHMENT_MIN_W, h: ATTACHMENT_MIN_H };
  if (type === "image") return { w: IMAGE_MIN, h: IMAGE_MIN };
  if (type === "folder") return { w: FOLDER_MIN_W, h: FOLDER_MIN_H };
  return type === "note" ? { w: NOTE_MIN_W, h: NOTE_MIN_H } : { w: NODE_MIN_W, h: NODE_MIN_H };
}

// Texto
export const TEXT_SIZE_MIN = 8;
export const TEXT_SIZE_MAX = 400;
export const TEXT_SIZE_STEP = 4;
export const TEXT_DEFAULTS = {
  size: 48,
  weight: "medium" as TextWeight,
  family: "sans" as TextFamily,
  color: "#f2f2f4",
};
export const TEXT_WEIGHTS: Record<TextWeight, { short: string; label: string; css: number }> = {
  regular: { short: "R", label: "Regular", css: 400 },
  medium: { short: "M", label: "Médio", css: 500 },
  bold: { short: "B", label: "Negrito", css: 700 },
};
export const TEXT_FAMILIES: Record<TextFamily, { label: string; css: string }> = {
  sans: { label: "Sans", css: '"Segoe UI", system-ui, sans-serif' },
  serif: { label: "Serif", css: 'Georgia, "Times New Roman", serif' },
  mono: { label: "Mono", css: '"Cascadia Mono", Consolas, monospace' },
};
/** Cores do seletor do texto (a última posição da grade é a cor livre). */
export const TEXT_COLORS = [
  "#f2f2f4", "#000000", "#555558", "#8e8e93", "#ffffff", "#ff3b30", "#ff9500",
  "#ffcc00", "#34c759", "#0a84ff", "#5e5ce6", "#af52de", "#ff2d55",
];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Valida o que veio do disco (descarta itens malformados). */
export function sanitizeNodes(raw: unknown): CanvasNodeData[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((n): CanvasNodeData[] => {
    if (!n || typeof n !== "object") return [];
    const o = n as Record<string, unknown>;
    if (typeof o.id !== "string") return [];
    if (!isNum(o.x) || !isNum(o.y) || !isNum(o.w) || !isNum(o.h)) return [];
    const box = {
      x: o.x,
      y: o.y,
      ...(typeof o.group === "string" && o.group.length > 0 && o.group.length <= 64 ? { group: o.group } : {}),
    };

    if (o.type === "terminal" && typeof o.agent === "string" && o.agent in AGENTS) {
      const agent = o.agent as AgentKind;
      return [
        {
          id: o.id,
          type: "terminal",
          agent,
          title: typeof o.title === "string" && o.title.trim() ? o.title : AGENTS[agent].title,
          ...box,
          w: Math.max(NODE_MIN_W, o.w),
          h: Math.max(NODE_MIN_H, o.h),
        },
      ];
    }
    if (o.type === "image" && typeof o.file === "string" && IMAGE_FILE.test(o.file)) {
      return [
        {
          id: o.id,
          type: "image",
          file: o.file,
          ...box,
          w: Math.max(IMAGE_MIN, o.w),
          h: Math.max(IMAGE_MIN, o.h),
        },
      ];
    }
    if (o.type === "attachment" && typeof o.file === "string" && ATTACHMENT_FILE.test(o.file)) {
      return [
        {
          id: o.id,
          type: "attachment",
          file: o.file,
          name: typeof o.name === "string" && o.name ? o.name.slice(0, 200) : o.file,
          size: isNum(o.size) && o.size >= 0 ? o.size : 0,
          ...box,
          w: Math.max(ATTACHMENT_MIN_W, o.w),
          h: Math.max(ATTACHMENT_MIN_H, o.h),
        },
      ];
    }
    if (o.type === "board") {
      return [
        {
          id: o.id,
          type: "board",
          title: typeof o.title === "string" && o.title.trim() ? o.title.slice(0, 200) : BOARD_DEFAULT_TITLE,
          ...box,
          w: Math.max(BOARD_MIN_W, o.w),
          h: Math.max(BOARD_MIN_H, o.h),
        },
      ];
    }
    if (o.type === "portal") {
      const url = typeof o.url === "string" && /^https?:\/\//i.test(o.url) && o.url.length <= 4000 ? o.url : "";
      return [
        {
          id: o.id,
          type: "portal",
          url,
          ...box,
          w: Math.max(PORTAL_MIN_W, o.w),
          h: Math.max(PORTAL_MIN_H, o.h),
        },
      ];
    }
    if (o.type === "folder") {
      const d = FOLDER_DEFAULTS;
      return [
        {
          id: o.id,
          type: "folder",
          dir: relPath(o.dir, d.dir),
          openFile: typeof o.openFile === "string" ? relPath(o.openFile, "") || null : null,
          sidebar: typeof o.sidebar === "boolean" ? o.sidebar : d.sidebar,
          sort: o.sort === "modified" || o.sort === "size" ? o.sort : d.sort,
          font: typeof o.font === "string" ? o.font.slice(0, 100) : d.font,
          fontSize: isNum(o.fontSize)
            ? Math.min(FOLDER_FONT_MAX, Math.max(FOLDER_FONT_MIN, Math.round(o.fontSize)))
            : d.fontSize,
          tabSize: o.tabSize === 2 || o.tabSize === 8 ? o.tabSize : d.tabSize,
          wrap: typeof o.wrap === "boolean" ? o.wrap : d.wrap,
          markdown: typeof o.markdown === "boolean" ? o.markdown : d.markdown,
          ...box,
          w: Math.max(FOLDER_MIN_W, o.w),
          h: Math.max(FOLDER_MIN_H, o.h),
        },
      ];
    }
    if (o.type === "text") {
      return [
        {
          id: o.id,
          type: "text",
          text: typeof o.text === "string" ? o.text.slice(0, NOTE_MAX_TEXT) : "",
          size: isNum(o.size)
            ? Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(o.size)))
            : TEXT_DEFAULTS.size,
          weight: typeof o.weight === "string" && o.weight in TEXT_WEIGHTS ? (o.weight as TextWeight) : TEXT_DEFAULTS.weight,
          family: typeof o.family === "string" && o.family in TEXT_FAMILIES ? (o.family as TextFamily) : TEXT_DEFAULTS.family,
          color: typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : TEXT_DEFAULTS.color,
          ...box,
          // Medidos na tela (o texto informa o próprio tamanho).
          w: o.w,
          h: o.h,
        },
      ];
    }
    if (o.type === "note") {
      return [
        {
          id: o.id,
          type: "note",
          title: typeof o.title === "string" && o.title.trim() ? o.title.slice(0, 200) : NOTE_DEFAULTS.title,
          text: typeof o.text === "string" ? o.text.slice(0, NOTE_MAX_TEXT) : "",
          color: isNoteColor(o.color) ? o.color : NOTE_DEFAULTS.color,
          fontSize: isNum(o.fontSize)
            ? Math.min(NOTE_FONT_MAX, Math.max(NOTE_FONT_MIN, Math.round(o.fontSize)))
            : NOTE_DEFAULTS.fontSize,
          // Formato antigo: "mono" → padrão, "sans" → Segoe UI.
          font: o.font === "sans" ? "Segoe UI" : typeof o.font === "string" && o.font !== "mono" ? o.font.slice(0, 100) : "",
          preview: o.preview === true,
          ...box,
          w: Math.max(NOTE_MIN_W, o.w),
          h: Math.max(NOTE_MIN_H, o.h),
        },
      ];
    }
    return [];
  });
}
