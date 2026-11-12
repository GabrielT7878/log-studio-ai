import { openUrl } from "@tauri-apps/plugin-opener";
import { FullscreenButton } from "./FullscreenButton";
import DOMPurify from "dompurify";
import { ArrowDown } from "lucide-react";
import { Marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  noteTheme,
  NOTE_FONT_MAX,
  NOTE_FONT_MIN,
  NOTE_MIN_H,
  NOTE_MIN_W,
  noteFontFamily,
  type NodePatch,
  type NoteNodeData,
} from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";
import { registerNoteTextarea, toggleTask } from "../lib/noteFormat";
import { SmoothCaret } from "./SmoothCaret";
import { TitleInput } from "./TerminalNode";

// Markdown (GFM + quebras de linha). As caixas de tarefa ficam clicáveis.
const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    checkbox({ checked }) {
      return `<input type="checkbox" class="md-task"${checked ? " checked" : ""}> `;
    },
  },
});

/** Markdown → HTML limpo (sem scripts nem atributos perigosos). */
function renderMarkdown(text: string) {
  const html = markdown.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

/** Posição que a sincronia acabou de pôr em cada lado: o evento de rolagem que ela gera é só eco. */
const syncedTop = new WeakMap<HTMLElement, number>();

/** Rola `to` para a mesma proporção de rolagem de `from` (texto ↔ preview). */
function syncScroll(from: HTMLElement | null, to: HTMLElement | null) {
  if (!from || !to) return;
  // Eco de uma sincronia anterior (o evento chega atrasado): não devolve, senão os dois lados brigam.
  const echo = syncedTop.get(from);
  syncedTop.delete(from);
  if (echo !== undefined && Math.abs(from.scrollTop - echo) < 2) return;

  const fromMax = from.scrollHeight - from.clientHeight;
  const toMax = to.scrollHeight - to.clientHeight;
  if (toMax <= 0) return;
  const top = fromMax > 0 ? (from.scrollTop / fromMax) * toMax : 0;
  if (Math.abs(to.scrollTop - top) < 2) return;
  to.scrollTop = top;
  syncedTop.set(to, to.scrollTop);
}

const TO_END_MS = 250;

/** Rola `el` até o fim, animado (recalcula o fim a cada quadro). Devolve a função que cancela. */
function animateToEnd(el: HTMLElement) {
  const from = el.scrollTop;
  const start = performance.now();
  let frame = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - start) / TO_END_MS);
    const ease = 1 - (1 - t) ** 3;
    const end = el.scrollHeight - el.clientHeight;
    el.scrollTop = from + (end - from) * ease;
    if (t < 1) frame = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(frame);
}

/** Quanto falta rolar até o fim de `el` (px). */
const gapToEnd = (el: HTMLElement | null) => (el ? el.scrollHeight - el.clientHeight - el.scrollTop : 0);

/** Folga (px) para considerar que já está no fim (a seta para baixo some). */
const END_SLACK = 8;

/** Quanto de roda acumula para mudar 1 ponto (1 clique de roda ≈ 100). */
const WHEEL_STEP = 60;

interface Props {
  node: NoteNodeData;
  zoom: number;
  selected: boolean;
  editingTitle: boolean;
  /** Foca o texto ao montar (nota recém-criada). */
  autoFocus: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: NodePatch) => void;
  /** Esta janela está em tela cheia. */
  fullscreen?: boolean;
  onToggleFullscreen?: (id: string) => void;
  /** Fim da edição do nome (null = cancelado). */
  onTitleDone: (id: string, title: string | null) => void;
}

/** Nota no canvas (estilo post-it): faixa para arrastar, texto em Markdown e canto para redimensionar. */
export function NoteNode({ node, zoom, selected, editingTitle, autoFocus, onSelect, onChange, onTitleDone, fullscreen = false, onToggleFullscreen }: Props) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const colors = noteTheme(node.color);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando a nota é criada
  }, [autoFocus]);

  // Ctrl + roda (ou pinça) numa nota SELECIONADA → muda o tamanho da fonte dela.
  // Não selecionada: o evento segue para o canvas (zoom).
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ fontSize: node.fontSize, onChange, selected });
  latest.current = { fontSize: node.fontSize, onChange, selected };
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !latest.current.selected) return;
      e.preventDefault();
      e.stopPropagation();
      acc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (Math.abs(acc) < WHEEL_STEP) return;
      const step = acc < 0 ? 1 : -1; // roda para cima aumenta
      acc = 0;
      const { fontSize, onChange: change } = latest.current;
      const next = Math.min(NOTE_FONT_MAX, Math.max(NOTE_FONT_MIN, fontSize + step));
      if (next !== fontSize) change(node.id, { fontSize: next });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [node.id]);

  const html = useMemo(
    () => (node.preview ? renderMarkdown(node.text) : ""),
    [node.preview, node.text],
  );

  // Ao ligar o preview (e quando ele muda de altura), alinha com a posição do texto.
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (node.preview) syncScroll(textRef.current, previewRef.current);
  }, [node.preview, html]);

  // Seta para baixo: aparece quando a nota não está rolada até o fim.
  const [showToEnd, setShowToEnd] = useState(false);
  const updateToEnd = () =>
    setShowToEnd(Math.max(gapToEnd(textRef.current), gapToEnd(previewRef.current)) > END_SLACK);
  useEffect(updateToEnd, [node.text, node.preview, node.fontSize, node.font, node.w, node.h, zoom, html]);

  /** Rola até o fim (animado). O preview acompanha pela sincronia; se só ele rola, rola ele. */
  const cancelToEnd = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelToEnd.current?.(), []);
  const scrollToEnd = () => {
    const ta = textRef.current;
    const target = ta && ta.scrollHeight > ta.clientHeight ? ta : previewRef.current;
    if (!target) return;
    cancelToEnd.current?.();
    cancelToEnd.current = animateToEnd(target);
  };

  const startMove = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { w, h } = node;
    dragPointer(e, (dx, dy) =>
      onChange(node.id, {
        w: Math.max(NOTE_MIN_W, w + dx / zoom),
        h: Math.max(NOTE_MIN_H, h + dy / zoom),
      }),
    );
  };

  /** Preview: marcar tarefas e abrir links. */
  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.classList.contains("md-task")) {
      e.preventDefault();
      const all = Array.from(e.currentTarget.querySelectorAll("input.md-task"));
      onChange(node.id, { text: toggleTask(node.text, all.indexOf(target)) });
      return;
    }
    const link = target.closest("a");
    if (link) {
      e.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) openUrl(href).catch((err) => console.warn(err));
    }
  };

  return (
    <div
      ref={rootRef}
      className={`canvas-node note-node${selected ? " selected" : ""}${fullscreen ? " fullscreen" : ""}`}
      data-node-id={node.id}
      style={
        {
          "--nx": node.x,
          "--ny": node.y,
          "--nw": node.w,
          "--nh": node.h,
          "--note-bg": colors.bg,
          "--note-band": colors.band,
          "--note-text": colors.text,
          "--note-font": noteFontFamily(node.font),
          "--note-size": node.fontSize,
          zIndex: selected ? 2 : 1,
        } as React.CSSProperties
      }
      onPointerDown={() => onSelect(node.id)}
    >
      <div className="note-header" onPointerDown={editingTitle ? undefined : startMove}>
        {editingTitle ? (
          <TitleInput value={node.title} onDone={(t) => onTitleDone(node.id, t)} />
        ) : (
          <span className="note-title" title="Arraste para mover">
            {node.title}
          </span>
        )}
        {onToggleFullscreen && (
          <FullscreenButton className="note-fs-btn" size={12} active={fullscreen} onToggle={() => onToggleFullscreen(node.id)} />
        )}
      </div>

      {/* Texto à esquerda; com o M ligado, preview formatado à direita. */}
      <div className={`note-body${node.preview ? " split" : ""}`}>
        <textarea
          ref={(el) => {
            textRef.current = el;
            registerNoteTextarea(node.id, el);
          }}
          className="note-text"
          value={node.text}
          placeholder="Escreva uma nota…"
          spellCheck={false}
          onChange={(e) => onChange(node.id, { text: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
          onScroll={() => {
            if (node.preview) syncScroll(textRef.current, previewRef.current);
            updateToEnd();
          }}
        />
        <SmoothCaret textarea={textRef} deps={[node.fontSize, node.font, zoom]} />

        {node.preview && (
          <div
            ref={previewRef}
            className="note-preview"
            onScroll={() => {
              syncScroll(previewRef.current, textRef.current);
              updateToEnd();
            }}
            onClick={onPreviewClick}
            dangerouslySetInnerHTML={{ __html: html || '<p class="md-empty">Nada para mostrar</p>' }}
          />
        )}

        <button
          className={`note-to-end${showToEnd ? " visible" : ""}`}
          title="Ir para o fim da nota"
          tabIndex={showToEnd ? 0 : -1}
          onClick={scrollToEnd}
        >
          <ArrowDown strokeWidth={2.2} />
        </button>
      </div>

      <div className="node-resize" title="Redimensionar" onPointerDown={startResize} />
    </div>
  );
}
