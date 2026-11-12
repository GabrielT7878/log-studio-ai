import { CircleDot, Folder, SquareTerminal } from "lucide-react";
import { FullscreenButton } from "./FullscreenButton";
import { useEffect, useLayoutEffect, useRef } from "react";
import {
  AGENTS,
  NODE_MIN_H,
  NODE_MIN_W,
  TERM_FONT_MAX,
  TERM_FONT_MIN,
  type NodePatch,
  type TerminalNodeData,
} from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";
import * as terminals from "../lib/terminals";

/** px de roda acumulados para mudar 1 ponto da fonte (igual à nota). */
const WHEEL_STEP = 60;

interface Props {
  node: TerminalNodeData;
  space: string;
  projectId: string;
  zoom: number;
  selected: boolean;
  editingTitle: boolean;
  onSelect: (id: string) => void;
  /** Mudança de posição/tamanho (coordenadas do mundo). */
  onChange: (id: string, patch: NodePatch) => void;
  /** Esta janela está em tela cheia. */
  fullscreen?: boolean;
  onToggleFullscreen?: (id: string) => void;
  onTitleDone: (id: string, title: string | null) => void;
}

/** "..\Pai\Projeto" a partir do espaço + id do projeto. */
function shortPath(space: string, projectId: string) {
  const parts = [space, ...projectId.split("/")];
  return `..\\${parts.slice(-2).join("\\")}`;
}

export function TerminalNode({
  node,
  space,
  projectId,
  zoom,
  selected,
  editingTitle,
  onSelect,
  onChange,
  onTitleDone,
  fullscreen = false,
  onToggleFullscreen,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const agent = AGENTS[node.agent];

  // Anexa o terminal (cria e inicia o processo na primeira vez).
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    terminals.attach(node.id, body, { space, project: projectId, agent: node.agent, fontSize: node.fontSize }, zoom);
    return () => terminals.detach(node.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao montar/desmontar o card
  }, [node.id]);

  // Fonte acompanha o zoom (colunas/linhas não mudam).
  useEffect(() => terminals.setZoom(node.id, zoom), [node.id, zoom]);

  // Tamanho da fonte do terminal (Ctrl + roda): colunas/linhas mudam.
  useEffect(() => terminals.setFontSize(node.id, node.fontSize), [node.id, node.fontSize]);

  // Ctrl + roda (ou pinça) num terminal SELECIONADO → muda o tamanho da fonte dele.
  // Em captura: passa na frente do xterm (que usaria a roda para rolar o histórico).
  // Não selecionado: o evento segue para o canvas (zoom).
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
      const next = Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, fontSize + step));
      if (next !== fontSize) change(node.id, { fontSize: next });
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [node.id]);

  // Tela cheia: colunas/linhas acompanham o tamanho (ao entrar, ao sair e se o app mudar de tamanho).
  const wasFullscreen = useRef(fullscreen);
  useEffect(() => {
    const changed = wasFullscreen.current !== fullscreen;
    wasFullscreen.current = fullscreen;
    const frame = changed ? requestAnimationFrame(() => terminals.fit(node.id)) : 0;
    let ro: ResizeObserver | undefined;
    if (fullscreen && bodyRef.current) {
      ro = new ResizeObserver(() => terminals.fit(node.id));
      ro.observe(bodyRef.current);
    }
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [fullscreen, node.id]);

  const startMove = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { w, h } = node;
    dragPointer(
      e,
      (dx, dy) =>
        onChange(node.id, {
          w: Math.max(NODE_MIN_W, w + dx / zoom),
          h: Math.max(NODE_MIN_H, h + dy / zoom),
        }),
      () => terminals.fit(node.id),
    );
  };

  return (
    <div
      ref={rootRef}
      className={`canvas-node term-node${selected ? " selected" : ""}${fullscreen ? " fullscreen" : ""}`}
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
      <div className="term-chrome term-header" onPointerDown={editingTitle ? undefined : startMove}>
        {node.agent === "shell" ? (
          <SquareTerminal size={11} color={agent.color} />
        ) : (
          <CircleDot size={11} color={agent.color} />
        )}
        {editingTitle ? (
          <TitleInput value={node.title} onDone={(t) => onTitleDone(node.id, t)} />
        ) : (
          <span className="term-title">{node.title}</span>
        )}
        {onToggleFullscreen && (
          <FullscreenButton className="term-fs-btn" size={11} active={fullscreen} onToggle={() => onToggleFullscreen(node.id)} />
        )}
      </div>

      <div className="term-body" ref={bodyRef} onPointerDown={() => terminals.focus(node.id)} />

      <div className="term-chrome term-footer">
        <span className="term-path">
          <Folder size={9} /> {shortPath(space, projectId)}
        </span>
        <SquareTerminal size={9} />
      </div>

      <div className="node-resize" title="Redimensionar" onPointerDown={startResize} />
    </div>
  );
}

/** Edição do título no cabeçalho. Enter/blur confirma, Esc cancela. */
export function TitleInput({ value, onDone }: { value: string; onDone: (title: string | null) => void }) {
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      className="term-title-input"
      defaultValue={value}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
