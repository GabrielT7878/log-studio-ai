import { Maximize2, Minimize2 } from "lucide-react";

/** Atalho da tela cheia (mostrado nas dicas). */
export const FULLSCREEN_SHORTCUT = "Ctrl+Shift+F";

/**
 * Botão ⤢/⤡ de tela cheia de uma janela do canvas. Não deixa o clique começar o
 * arraste do cabeçalho (o pointerdown não sobe).
 */
export function FullscreenButton({
  active,
  onToggle,
  className = "fb-icon-btn",
  size = 14,
}: {
  active: boolean;
  onToggle: () => void;
  className?: string;
  size?: number;
}) {
  return (
    <button
      className={`${className} fs-btn`}
      title={active ? `Sair da tela cheia (${FULLSCREEN_SHORTCUT})` : `Tela cheia (${FULLSCREEN_SHORTCUT})`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {active ? <Minimize2 size={size} /> : <Maximize2 size={size} />}
    </button>
  );
}
