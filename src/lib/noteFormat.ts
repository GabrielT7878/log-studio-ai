// Formatação Markdown das notas: atua no texto selecionado (ou no cursor)
// do <textarea> da nota e devolve o texto novo + a seleção a restaurar.

export type FormatKind =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "h1"
  | "h2"
  | "h3"
  | "checklist"
  | "list"
  | "codeblock";

/** Textareas das notas montadas (id → elemento), para ler/restaurar a seleção. */
const textareas = new Map<string, HTMLTextAreaElement>();

export function registerNoteTextarea(id: string, el: HTMLTextAreaElement | null) {
  if (el) textareas.set(id, el);
  else textareas.delete(id);
}

interface Result {
  text: string;
  start: number;
  end: number;
}

/** Envolve a seleção com marcadores (ou tira, se já estiver envolvida). */
function wrap(text: string, s: number, e: number, before: string, after: string, placeholder: string): Result {
  // Já envolvida → remove os marcadores.
  if (text.slice(s - before.length, s) === before && text.slice(e, e + after.length) === after) {
    const out = text.slice(0, s - before.length) + text.slice(s, e) + text.slice(e + after.length);
    return { text: out, start: s - before.length, end: e - before.length };
  }
  const inner = s === e ? placeholder : text.slice(s, e);
  const out = text.slice(0, s) + before + inner + after + text.slice(e);
  const start = s + before.length;
  return { text: out, start, end: start + inner.length };
}

/** Prefixa as linhas da seleção (ou tira o prefixo, se todas já tiverem). */
function prefixLines(text: string, s: number, e: number, prefix: string): Result {
  const lineStart = text.lastIndexOf("\n", s - 1) + 1;
  const nl = text.indexOf("\n", e);
  const lineEnd = nl === -1 ? text.length : nl;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const allHave = lines.every((l) => l.startsWith(prefix));
  const block = lines.map((l) => (allHave ? l.slice(prefix.length) : l.startsWith(prefix) ? l : prefix + l)).join("\n");
  const out = text.slice(0, lineStart) + block + text.slice(lineEnd);
  // Sem seleção: cursor no fim da linha. Com seleção: seleciona o bloco alterado.
  const blockEnd = lineStart + block.length;
  return s === e ? { text: out, start: blockEnd, end: blockEnd } : { text: out, start: lineStart, end: blockEnd };
}

/**
 * Título de nível `level` nas linhas da seleção: troca o nível que já existir;
 * se todas já estiverem nesse nível, remove o título.
 */
function setHeading(text: string, s: number, e: number, level: number): Result {
  const prefix = "#".repeat(level) + " ";
  const lineStart = text.lastIndexOf("\n", s - 1) + 1;
  const nl = text.indexOf("\n", e);
  const lineEnd = nl === -1 ? text.length : nl;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const HEADING = /^#{1,6} /;
  const allSame = lines.every((l) => l.startsWith(prefix));
  const block = lines.map((l) => (allSame ? "" : prefix) + l.replace(HEADING, "")).join("\n");
  const out = text.slice(0, lineStart) + block + text.slice(lineEnd);
  const blockEnd = lineStart + block.length;
  return s === e ? { text: out, start: blockEnd, end: blockEnd } : { text: out, start: lineStart, end: blockEnd };
}

/** Aplica a formatação na nota `id`; devolve null se a nota não estiver na tela. */
export function applyFormat(id: string, kind: FormatKind, text: string): Result | null {
  const el = textareas.get(id);
  if (!el) return null;
  const s = el.selectionStart ?? text.length;
  const e = el.selectionEnd ?? text.length;
  switch (kind) {
    case "bold":
      return wrap(text, s, e, "**", "**", "negrito");
    case "italic":
      return wrap(text, s, e, "*", "*", "itálico");
    case "strike":
      return wrap(text, s, e, "~~", "~~", "riscado");
    case "code":
      return wrap(text, s, e, "`", "`", "código");
    case "codeblock":
      return wrap(text, s, e, "```\n", "\n```", "código");
    case "h1":
      return setHeading(text, s, e, 1);
    case "h2":
      return setHeading(text, s, e, 2);
    case "h3":
      return setHeading(text, s, e, 3);
    case "checklist":
      return prefixLines(text, s, e, "- [ ] ");
    case "list":
      return prefixLines(text, s, e, "- ");
  }
}

/** Depois que o React aplicar o texto novo, devolve o foco e a seleção. */
export function restoreSelection(id: string, start: number, end: number) {
  requestAnimationFrame(() => {
    const el = textareas.get(id);
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
  });
}

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/** Marca/desmarca a n-ésima tarefa ("- [ ]") do texto. */
export function toggleTask(text: string, index: number): string {
  let n = -1;
  return text
    .split("\n")
    .map((line) => {
      const m = TASK_LINE.exec(line);
      if (!m) return line;
      n++;
      if (n !== index) return line;
      const mark = m[2] === " " ? "x" : " ";
      return m[1] + mark + m[3] + line.slice(m[0].length);
    })
    .join("\n");
}
