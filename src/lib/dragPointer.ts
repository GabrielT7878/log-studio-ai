/**
 * Arrasta com o ponteiro a partir de um pointerdown, chamando `onMove(dx, dy)`
 * com o deslocamento em pixels de tela; `onEnd` ao soltar.
 */
export function dragPointer(
  e: React.PointerEvent,
  onMove: (dx: number, dy: number) => void,
  onEnd?: () => void,
) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  document.documentElement.classList.add("pointer-dragging");
  const sx = e.clientX;
  const sy = e.clientY;
  const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy);
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    document.documentElement.classList.remove("pointer-dragging");
    onEnd?.();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}
