import { dragPointer } from "../lib/dragPointer";
import type { NodePatch } from "../lib/canvasNodes";

// Redimensionar janelas do canvas por qualquer lado ou canto (8 alças).

export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "sw", "se"];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResizeOptions {
  min: { w: number; h: number };
  /** Mantém a proporção largura/altura (imagem). */
  ratio?: number;
  /** Só a largura muda (ex.: script recolhido). */
  lockH?: boolean;
}

/**
 * Retângulo novo ao arrastar a alça `dir` por (dx, dy) em unidades do mundo. O lado oposto
 * fica parado; respeita o tamanho mínimo (e a proporção, se houver).
 */
export function resizeRect(start: Rect, dir: ResizeDir, dx: number, dy: number, opt: ResizeOptions): Rect {
  const left = dir.includes("w");
  const right = dir.includes("e");
  const top = dir.includes("n") && !opt.lockH;
  const bottom = dir.includes("s") && !opt.lockH;

  let w = start.w;
  let h = start.h;
  if (right) w = start.w + dx;
  if (left) w = start.w - dx;
  if (bottom) h = start.h + dy;
  if (top) h = start.h - dy;

  if (opt.ratio) {
    const r = opt.ratio;
    const minW = Math.max(opt.min.w, opt.min.h * r);
    // Canto: usa o eixo que mais mudou. Lado: o eixo do lado.
    const horizontal = left || right;
    const vertical = top || bottom;
    const byW = horizontal && (!vertical || Math.abs(w - start.w) > Math.abs(h - start.h) * r);
    w = Math.max(minW, byW ? w : h * r);
    h = w / r;
  } else {
    w = Math.max(opt.min.w, w);
    h = opt.lockH ? start.h : Math.max(opt.min.h, h);
  }

  return {
    x: left ? start.x + start.w - w : start.x,
    y: top ? start.y + start.h - h : start.y,
    w,
    h,
  };
}

/** Começa a redimensionar a janela pela alça `dir` (chama `onChange` a cada movimento). */
export function startNodeResize(
  e: React.PointerEvent,
  dir: ResizeDir,
  node: Rect & { id: string },
  zoom: number,
  onChange: (id: string, patch: NodePatch) => void,
  opt: ResizeOptions & { onEnd?: () => void },
) {
  const start = { x: node.x, y: node.y, w: node.w, h: node.h };
  dragPointer(
    e,
    (dx, dy) => {
      const r = resizeRect(start, dir, dx / zoom, dy / zoom, opt);
      onChange(node.id, opt.lockH ? { x: r.x, y: r.y, w: r.w } : r);
    },
    opt.onEnd,
  );
}

/** As 8 alças (lados e cantos) de uma janela. */
export function ResizeHandles({ onStart }: { onStart: (e: React.PointerEvent, dir: ResizeDir) => void }) {
  return (
    <>
      {DIRS.map((d) => (
        <div
          key={d}
          className={`node-resize node-resize-${d}`}
          title="Redimensionar"
          onPointerDown={(e) => onStart(e, d)}
        />
      ))}
    </>
  );
}
