import { Check } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: ComponentType<{ size?: number }>;
  onSelect?: () => void;
  /** Ação destrutiva (ex.: Excluir) — exibida em vermelho. */
  danger?: boolean;
  /** Item de seleção: mostra ✓ quando true (no lugar do ícone). */
  checked?: boolean;
  /** Desenha uma linha divisória antes do item. */
  divider?: boolean;
}

const MARGIN = 8;

export function ContextMenu({
  x,
  y,
  items,
  closing,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  closing: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Mantém o menu dentro da janela.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - width - MARGIN),
      y: Math.min(y, window.innerHeight - height - MARGIN),
    });
  }, [x, y]);

  // Fecha ao clicar fora, apertar Esc ou a janela perder o foco.
  useEffect(() => {
    if (closing) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [closing, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`ctx-menu${closing ? " closing" : ""}`}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      {items.map(({ label, icon: Icon, onSelect, danger, checked, divider }) => (
        <Fragment key={label}>
          {divider && <div className="ctx-divider" role="separator" />}
          <button
            className={`ctx-item${danger ? " danger" : ""}`}
            role={checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={checked}
            onClick={() => {
              onSelect?.();
              onClose();
            }}
          >
            {checked !== undefined ? (
              <span className="ctx-check">{checked && <Check size={15} />}</span>
            ) : (
              Icon && <Icon size={15} />
            )}
            <span className="ctx-label">{label}</span>
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
