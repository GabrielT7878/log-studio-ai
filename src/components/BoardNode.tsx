import { PenTool } from "lucide-react";
import { FullscreenButton } from "./FullscreenButton";
import { lazy, Suspense } from "react";
import { BOARD_MIN_H, BOARD_MIN_W, type BoardNodeData, type NodePatch } from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";

// O Excalidraw (pesado) só é carregado quando algum quadro aparece.
const ExcalidrawBoard = lazy(() => import("./ExcalidrawBoard"));

interface Props {
  node: BoardNodeData;
  space: string;
  projectId: string;
  zoom: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: NodePatch) => void;
  /** Esta janela está em tela cheia. */
  fullscreen?: boolean;
  onToggleFullscreen?: (id: string) => void;
}

/**
 * Quadro: Excalidraw numa janela. Na janela do canvas mostra só a prévia do desenho;
 * para editar, vai para tela cheia (Excalidraw a 100%, sem misturar com o zoom do canvas).
 */
export function BoardNode({ node, space, projectId, zoom, selected, onSelect, onChange, fullscreen = false, onToggleFullscreen }: Props) {
  const onHeaderDown = (e: React.PointerEvent<HTMLElement>) => {
    onSelect(node.id);
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { w, h } = node;
    dragPointer(e, (dx, dy) =>
      onChange(node.id, { w: Math.max(BOARD_MIN_W, w + dx / zoom), h: Math.max(BOARD_MIN_H, h + dy / zoom) }),
    );
  };

  return (
    <div
      className={`canvas-node board-node${selected ? " selected" : ""}${fullscreen ? " fullscreen" : ""}`}
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
      <div className="bd-header" onPointerDown={onHeaderDown}>
        <PenTool size={14} />
        <span className="bd-title">{node.title}</span>
        {onToggleFullscreen && (
          <FullscreenButton className="bd-fs-btn" size={13} active={fullscreen} onToggle={() => onToggleFullscreen(node.id)} />
        )}
      </div>
      <div className="bd-body">
        <Suspense fallback={<div className="bd-loading">Carregando quadro…</div>}>
          <ExcalidrawBoard
            space={space}
            projectId={projectId}
            id={node.id}
            editing={fullscreen}
            onEdit={() => {
              onSelect(node.id);
              onToggleFullscreen?.(node.id);
            }}
          />
        </Suspense>
      </div>
      <div className="node-resize" title="Redimensionar" onPointerDown={startResize} />
    </div>
  );
}
