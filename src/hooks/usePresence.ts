import { useEffect, useState } from "react";

/**
 * Mantém um componente montado por `duration` ms depois de fechar,
 * para dar tempo da animação de saída rodar.
 */
export function usePresence(open: boolean, duration: number) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(t);
  }, [open, duration]);

  return { mounted, closing: mounted && !open };
}
