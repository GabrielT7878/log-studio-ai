import { PenTool } from "lucide-react";
import { ResizeHandles, startNodeResize, type ResizeDir } from "./ResizeHandles";
import { FullscreenButton } from "./FullscreenButton";
import { lazy, Suspense } from "react";
import { BOARD_MIN_H, BOARD_MIN_W, type BoardNodeData, type NodePatch } from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";
import { TitleInput } from "./TerminalNode";

// O Excalidraw (pesado) só é carregado quando algum quadro aparece.
const ExcalidrawBoard = lazy(() => import("./ExcalidrawBoard"));

interface Props {
  node: BoardNodeData;
  space: string;
  projectId: string;
  zoom: number;
  selected: boolean;
  /** Nome em edição no cabeçalho (botão Renomear / F2). */
  editingTitle: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: NodePatch) => void;
  /** Fim da edição do nome (null = cancelou). */
  onTitleDone: (id: string, title: string | null) => void;
  /** Esta janela está em tela cheia. */
  fullscreen?: boolean;
  onToggleFullscreen?: (id: string) => void;
}

/**
 * Quadro: Excalidraw numa janela. Na janela do canvas mostra só a prévia do desenho;
 * para editar, vai para tela cheia (Excalidraw a 100%, sem misturar com o zoom do canvas).
 */
export function BoardNode({ node, space, projectId, zoom, selected, editingTitle, onSelect, onChange, onTitleDone, fullscreen = false, onToggleFullscreen }: Props) {
  const onHeaderDown = (e: React.PointerEvent<HTMLElement>) => {
    onSelect(node.id);
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent, dir: ResizeDir) => {
    onSelect(node.id);
    startNodeResize(e, dir, node, zoom, onChange, { min: { w: BOARD_MIN_W, h: BOARD_MIN_H } });
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
      <div className="bd-header" onPointerDown={editingTitle ? undefined : onHeaderDown}>
        <PenTool size={14} />
        {editingTitle ? (
          <TitleInput value={node.title} onDone={(t) => onTitleDone(node.id, t)} />
        ) : (
          <span className="bd-title">{node.title}</span>
        )}
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
      <ResizeHandles onStart={startResize} />
    </div>
  );
}
