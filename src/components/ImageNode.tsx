import { ImageOff } from "lucide-react";
import { ResizeHandles, startNodeResize, type ResizeDir } from "./ResizeHandles";
import { FullscreenButton } from "./FullscreenButton";
import { useEffect, useState } from "react";
import { imageUrl } from "../lib/canvasImages";
import { IMAGE_MIN, type ImageNodeData, type NodePatch } from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";

interface Props {
  node: ImageNodeData;
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

/** Imagem no canvas: arraste para mover, canto inferior direito redimensiona mantendo a proporção. */
export function ImageNode({ node, space, projectId, zoom, selected, onSelect, onChange, fullscreen = false, onToggleFullscreen }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    imageUrl(space, projectId, node.file)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [space, projectId, node.file]);

  const startMove = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent, dir: ResizeDir) => {
    onSelect(node.id);
    startNodeResize(e, dir, node, zoom, onChange, { min: { w: IMAGE_MIN, h: IMAGE_MIN }, ratio: node.w / node.h });
  };

  return (
    <div
      className={`canvas-node image-node${selected ? " selected" : ""}${fullscreen ? " fullscreen" : ""}`}
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
      onPointerDown={startMove}
    >
      {url && !failed ? (
        <img src={url} alt="" draggable={false} />
      ) : failed ? (
        <div className="image-missing">
          <ImageOff size={20} />
          <span>Imagem não encontrada</span>
        </div>
      ) : null}

      {onToggleFullscreen && (
        <FullscreenButton className="img-fs-btn" size={14} active={fullscreen} onToggle={() => onToggleFullscreen(node.id)} />
      )}
      <ResizeHandles onStart={startResize} />
    </div>
  );
}
