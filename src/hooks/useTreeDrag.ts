import { useCallback, useRef, useState } from "react";

export type DropPos = "before" | "after" | "inside";

/** Onde soltar: relativo ao item `id`, ou no fim da raiz quando `id === null`. */
export interface DropTarget {
  id: string | null;
  pos: DropPos;
}

const THRESHOLD = 5; // px de movimento até o arraste começar

/** Descobre o destino do drop a partir da posição do ponteiro. */
function computeTarget(x: number, y: number, dragId: string, list: HTMLElement): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el || !list.contains(el)) return null;

  // Uma pasta não pode ser solta dentro dela mesma nem das suas subpastas.
  if (el.closest(`[data-folder-id="${CSS.escape(dragId)}"]`)) return null;

  // Área "Pasta vazia" → dentro daquela pasta.
  const empty = el.closest<HTMLElement>("[data-empty-folder]");
  if (empty) return { id: empty.dataset.emptyFolder!, pos: "inside" };

  const row = el.closest<HTMLElement>("[data-node-id]");
  if (row) {
    const id = row.dataset.nodeId!;
    if (id === dragId) return null;
    const r = row.getBoundingClientRect();
    const t = (y - r.top) / r.height;

    if (row.dataset.kind === "folder") {
      if (t < 0.3) return { id, pos: "before" };
      // Pasta aberta: a metade de baixo também conta como "dentro".
      if (row.dataset.expanded !== "true" && t > 0.7) return { id, pos: "after" };
      return { id, pos: "inside" };
    }
    return { id, pos: t < 0.5 ? "before" : "after" };
  }

  // Recuo/guia dentro de uma pasta: não é destino válido.
  if (el.closest(".tree-folder")) return null;

  // Espaço vazio da lista → fim da raiz.
  return { id: null, pos: "after" };
}

export function useTreeDrag(
  listRef: React.RefObject<HTMLElement | null>,
  onDrop: (dragId: string, target: DropTarget) => void,
) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);

  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const start = useCallback(
    (e: React.PointerEvent, id: string, label: string) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("input")) return;

      const sx = e.clientX;
      const sy = e.clientY;
      let started = false;
      let current: DropTarget | null = null;

      const onMove = (ev: PointerEvent) => {
        if (!started) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
          started = true;
          setDragId(id);
          document.documentElement.classList.add("tree-dragging");
        }
        const list = listRef.current;
        current = list ? computeTarget(ev.clientX, ev.clientY, id, list) : null;
        setTarget(current);
        setGhost({ x: ev.clientX, y: ev.clientY, label });
      };

      const finish = (drop: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        if (!started) return;

        document.documentElement.classList.remove("tree-dragging");
        // Engole o "click" que o navegador dispara logo após soltar
        // (para não abrir/fechar a pasta sem querer).
        const swallow = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);

        if (drop && current) onDropRef.current(id, current);
        setDragId(null);
        setTarget(null);
        setGhost(null);
      };

      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      const onKey = (ke: KeyboardEvent) => {
        if (ke.key === "Escape") finish(false);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
    },
    [listRef],
  );

  return { dragId, target, ghost, start };
}
