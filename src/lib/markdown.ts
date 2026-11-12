// Markdown → HTML seguro (GFM, quebras de linha), para mostrar arquivos .md.
import DOMPurify from "dompurify";
import { Marked } from "marked";

const markdown = new Marked({ gfm: true, breaks: true });

/** Converte Markdown em HTML limpo (sem scripts nem atributos perigosos). */
export function renderMarkdown(text: string): string {
  const html = markdown.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
