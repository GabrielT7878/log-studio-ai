import { useCallback, useEffect, useRef, useState } from "react";
import { usePresence } from "./usePresence";

/** Aviso flutuante temporário (ex.: erros do backend). */
export function useToast(duration = 4500) {
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const presence = usePresence(open, 160);

  const show = useCallback(
    (msg: string) => {
      setMessage(msg);
      setOpen(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setOpen(false), duration);
    },
    [duration],
  );

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { message, presence, show, hide };
}
