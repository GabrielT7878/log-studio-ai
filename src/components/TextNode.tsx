import { useEffect, useLayoutEffect, useRef } from "react";
import { TEXT_FAMILIES, TEXT_WEIGHTS, type NodePatch, type TextNodeData } from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";

interface Props {
  node: TextNodeData;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: NodePatch) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (id: string) => void;
}

/**
 * Texto solto no canvas. Fora da edição: arrastar move, clique duplo edita.
 * Em edição: campo editável (texto puro); Esc ou clicar fora termina.
 */
export function TextNode({ node, zoom, selected, editing, onSelect, onChange, onStartEdit, onEndEdit }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ node, onChange });
  latest.current = { node, onChange };

  // Informa o tamanho na tela (dividido pelo zoom) para seleção, grupos e centralizar.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => {
      const zoom = parseFloat(getComputedStyle(el).getPropertyValue("--zoom")) || 1;
      const w = el.offsetWidth / zoom;
      const h = el.offsetHeight / zoom;
      const { node: n, onChange: change } = latest.current;
      if (Math.abs(w - n.w) > 0.5 || Math.abs(h - n.h) > 0.5) change(n.id, { w, h });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // O conteúdo do campo editável não é controlado pelo React (evita o cursor pular):
  // só é reescrito quando o texto muda por fora.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.innerText !== node.text) el.innerText = node.text;
  }, [node.text]);

  // Entrou em edição: foca e seleciona tudo.
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const startMove = (e: React.PointerEvent) => {
    onSelect(node.id);
    if (editing) {
      e.stopPropagation(); // em edição, o ponteiro seleciona texto
      return;
    }
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  return (
    <div
      ref={rootRef}
      className={`canvas-node text-node${selected ? " selected" : ""}${editing ? " editing" : ""}`}
      data-node-id={node.id}
      style={
        {
          "--nx": node.x,
          "--ny": node.y,
          "--text-size": node.size,
          "--text-color": node.color,
          "--text-weight": TEXT_WEIGHTS[node.weight].css,
          "--text-family": TEXT_FAMILIES[node.family].css,
          zIndex: selected ? 2 : 1,
        } as React.CSSProperties
      }
      onPointerDown={startMove}
      onDoubleClick={() => !editing && onStartEdit(node.id)}
    >
      <div
        ref={ref}
        className="text-edit"
        data-placeholder="Texto"
        contentEditable={editing ? "plaintext-only" : false}
        suppressContentEditableWarning
        spellCheck={false}
        onInput={(e) => onChange(node.id, { text: e.currentTarget.innerText })}
        onBlur={() => editing && onEndEdit(node.id)}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
      />
    </div>
  );
}
