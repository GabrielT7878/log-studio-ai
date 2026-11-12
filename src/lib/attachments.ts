// Anexos: tipo de prévia por extensão e tamanhos padrão do card.

export type AttachmentKind = "pdf" | "video" | "audio" | "text" | "office" | "exec" | "file";

const EXT: Record<Exclude<AttachmentKind, "file">, string[]> = {
  pdf: ["pdf"],
  video: ["mp4", "webm", "mov", "m4v", "ogv"],
  audio: ["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac", "opus"],
  // Executáveis/scripts: nunca abertos pelo app (mesma lista do backend).
  exec: [
    "exe", "msi", "msp", "bat", "cmd", "com", "scr", "pif", "ps1", "psm1", "vbs", "vbe", "js", "jse",
    "wsf", "wsh", "hta", "lnk", "reg", "jar", "cpl", "msc", "appref-ms", "application", "gadget", "inf",
    "scf", "url",
  ],
  text: [
    "txt", "md", "markdown", "mdx", "json", "jsonc", "csv", "tsv", "log", "xml", "yaml", "yml", "toml",
    "ini", "cfg", "conf", "env", "html", "htm", "css", "scss", "less", "ts", "tsx", "jsx", "mjs", "cjs",
    "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cc", "cs", "rb", "php", "sh", "bash", "zsh",
    "sql", "lua", "swift", "dart", "vue", "svelte", "gradle", "r", "pl", "graphql", "proto", "diff", "patch",
    "gitignore", "dockerfile",
  ],
  office: ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"],
};

/** Extensões de imagem: viram o card de Imagem (não um anexo). */
export const IMAGE_FILE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Tipo de prévia (executáveis primeiro: um .js nunca é "aberto", só pré-visualizado como exec). */
export function attachmentKind(name: string): AttachmentKind {
  const ext = extOf(name);
  if (EXT.exec.includes(ext)) return "exec";
  for (const kind of ["pdf", "video", "audio", "text", "office"] as const) {
    if (EXT[kind].includes(ext)) return kind;
  }
  return "file";
}

/** Tamanho padrão do card (unidades do mundo) para cada tipo. */
export function attachmentSize(kind: AttachmentKind): { w: number; h: number } {
  switch (kind) {
    case "pdf":
      return { w: 620, h: 800 };
    case "video":
      return { w: 640, h: 420 };
    case "audio":
      return { w: 380, h: 120 };
    case "text":
      return { w: 560, h: 440 };
    default:
      return { w: 300, h: 210 };
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** CSV/TSV simples → linhas (aspas duplas, separador , ou tab), até `max` linhas. */
export function parseDelimited(text: string, sep: string, max = 500): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < max; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if ((cell || row.length) && rows.length < max) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
