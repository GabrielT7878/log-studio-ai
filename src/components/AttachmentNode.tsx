import { convertFileSrc } from "@tauri-apps/api/core";
import { FullscreenButton } from "./FullscreenButton";
import {
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { attachmentKind, extOf, formatBytes, parseDelimited, type AttachmentKind } from "../lib/attachments";
import { ATTACHMENT_MIN_H, ATTACHMENT_MIN_W, type AttachmentNodeData, type NodePatch } from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  node: AttachmentNodeData;
  space: string;
  projectId: string;
  zoom: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: NodePatch) => void;
  /** Esta janela está em tela cheia. */
  fullscreen?: boolean;
  onToggleFullscreen?: (id: string) => void;
  onError: (message: string) => void;
}

function KindIcon({ kind, ext, size }: { kind: AttachmentKind; ext: string; size: number }) {
  if (kind === "pdf" || kind === "text") return ext === "csv" || ext === "tsv" ? <FileSpreadsheet size={size} /> : kind === "text" && !["txt", "md", "log"].includes(ext) ? <FileCode2 size={size} /> : <FileText size={size} />;
  if (kind === "video") return <FileVideo size={size} />;
  if (kind === "audio") return <FileAudio size={size} />;
  if (kind === "exec") return <ShieldAlert size={size} />;
  if (kind === "office") return ["xls", "xlsx", "ods"].includes(ext) ? <FileSpreadsheet size={size} /> : <FileText size={size} />;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return <FileArchive size={size} />;
  return <File size={size} />;
}

/** Anexo: qualquer arquivo copiado para o projeto, com prévia conforme o tipo. */
export function AttachmentNode({ node, space, projectId, zoom, selected, onSelect, onChange, onError, fullscreen = false, onToggleFullscreen }: Props) {
  const kind = attachmentKind(node.name);
  const ext = extOf(node.name);
  const [src, setSrc] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // PDF/vídeo/áudio: endereço do arquivo (protocolo de assets). Texto: conteúdo.
  useEffect(() => {
    let alive = true;
    setProblem(null);
    if (kind === "pdf" || kind === "video" || kind === "audio") {
      api
        .attachmentSrc(space, projectId, node.file)
        .then((path) => alive && setSrc(convertFileSrc(path)))
        .catch((e) => alive && setProblem(String(e)));
    } else if (kind === "text") {
      api
        .attachmentReadText(space, projectId, node.file)
        .then((f) => {
          if (!alive) return;
          if (f.kind === "text") setText(f.content);
          else setProblem(f.kind === "binary" ? "Não parece ser um arquivo de texto." : "Arquivo grande demais para a prévia.");
        })
        .catch((e) => alive && setProblem(String(e)));
    }
    return () => {
      alive = false;
    };
  }, [space, projectId, node.file, kind]);

  const html = useMemo(() => (text !== null && /^(md|markdown|mdx)$/.test(ext) ? renderMarkdown(text) : ""), [text, ext]);
  const table = useMemo(
    () => (text !== null && (ext === "csv" || ext === "tsv") ? parseDelimited(text, ext === "tsv" ? "\t" : ",") : null),
    [text, ext],
  );

  const open = () => api.openAttachment(space, projectId, node.file).catch((e) => onError(String(e)));
  const reveal = () => api.revealAttachment(space, projectId, node.file).catch((e) => onError(String(e)));

  const onHeaderDown = (e: React.PointerEvent<HTMLElement>) => {
    onSelect(node.id);
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && !t.classList.contains("at-drag")) return;
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { w, h } = node;
    dragPointer(e, (dx, dy) =>
      onChange(node.id, {
        w: Math.max(ATTACHMENT_MIN_W, w + dx / zoom),
        h: Math.max(ATTACHMENT_MIN_H, h + dy / zoom),
      }),
    );
  };

  const canOpen = kind !== "exec";
  const preview = kind === "pdf" || kind === "video" || kind === "audio" || kind === "text";

  return (
    <div
      className={`canvas-node attachment-node at-${kind}${selected ? " selected" : ""}${fullscreen ? " fullscreen" : ""}`}
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
      <div className="at-inner">
        <div className="at-header" onPointerDown={onHeaderDown}>
          <span className="at-icon at-drag">
            <KindIcon kind={kind} ext={ext} size={15} />
          </span>
          <span className="at-name at-drag" title={node.name}>
            {node.name}
          </span>
          <span className="at-size at-drag">{formatBytes(node.size)}</span>
          {canOpen && (
            <button className="fb-icon-btn" title="Abrir no app padrão" onClick={open}>
              <ExternalLink size={14} />
            </button>
          )}
          <button className="fb-icon-btn" title="Mostrar no Explorer" onClick={reveal}>
            <FolderOpen size={14} />
          </button>
          {onToggleFullscreen && (
            <FullscreenButton active={fullscreen} onToggle={() => onToggleFullscreen(node.id)} />
          )}
        </div>

        <div className="at-body">
          {problem ? (
            <div className="at-card">
              <KindIcon kind={kind} ext={ext} size={30} />
              <span>{problem}</span>
            </div>
          ) : preview ? (
            kind === "pdf" ? (
              src && <iframe className="at-frame" src={src} title={node.name} />
            ) : kind === "video" ? (
              src && <video className="at-video" src={src} controls preload="metadata" />
            ) : kind === "audio" ? (
              src && <audio className="at-audio" src={src} controls preload="metadata" />
            ) : text === null ? null : html ? (
              <div className="at-text at-markdown note-preview fb-scroll" dangerouslySetInnerHTML={{ __html: html }} />
            ) : table ? (
              <div className="at-text fb-scroll">
                <table className="at-table">
                  <tbody>
                    {table.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (i === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <pre className="at-text at-code fb-scroll">{text}</pre>
            )
          ) : (
            <div className="at-card">
              <KindIcon kind={kind} ext={ext} size={34} />
              <span className="at-type">{ext ? ext.toUpperCase() : "ARQUIVO"}</span>
              {kind === "exec" && (
                <span className="at-warn">Executável/script — por segurança não é aberto pelo app.</span>
              )}
              <div className="at-actions">
                {canOpen && (
                  <button className="pt-open-btn" onClick={open}>
                    <ExternalLink size={14} /> Abrir
                  </button>
                )}
                <button className="fbs-btn" onClick={reveal}>
                  Mostrar no Explorer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="node-resize" title="Redimensionar" onPointerDown={startResize} />
    </div>
  );
}
