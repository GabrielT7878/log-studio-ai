/** px até contar como arraste (abaixo disso é só clique). */
const THRESHOLD = 3;

/**
 * Arrastar na horizontal sobre um número para mudar o valor (cursor ↔).
 * Direita aumenta, esquerda diminui; `pxPerUnit` px de arraste = 1 unidade.
 */
export function scrubNumber(
  e: React.PointerEvent<HTMLElement>,
  start: number,
  onChange: (value: number) => void,
  { min, max, pxPerUnit }: { min: number; max: number; pxPerUnit: number },
) {
  if (e.button !== 0) return;
  e.preventDefault(); // não tira o foco do texto em edição
  e.stopPropagation();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const sx = e.clientX;
  let scrubbing = false;
  let last = start;

  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    if (!scrubbing) {
      if (Math.abs(dx) < THRESHOLD) return;
      scrubbing = true;
      document.documentElement.style.cursor = "ew-resize";
    }
    const value = Math.min(max, Math.max(min, Math.round(start + dx / pxPerUnit)));
    if (value !== last) {
      last = value;
      onChange(value);
    }
  };
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
    document.documentElement.style.cursor = "";
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
