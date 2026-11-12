import { useEffect, useRef, type RefObject } from "react";

// Estilos do textarea copiados para o "espelho" que mede onde o cursor está.
const MIRROR_PROPS = [
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "fontStretch",
  "fontFeatureSettings",
  "fontKerning",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textIndent",
  "tabSize",
  "whiteSpace",
  "overflowWrap",
  "wordBreak",
  "direction",
] as const;

interface Props {
  /** O textarea que ganha o cursor suave. Precisa ser irmão deste componente, num pai posicionado. */
  textarea: RefObject<HTMLTextAreaElement | null>;
  /** Valores que mudam a medida do texto (fonte, tamanho, zoom…): ao mudar, o cursor é reposicionado. */
  deps?: unknown[];
}

/**
 * Cursor de escrita suave (estilo Word): o cursor nativo fica transparente (CSS) e este,
 * desenhado por cima, desliza até a nova posição e pisca com fade.
 * Some quando o textarea perde o foco ou há texto selecionado.
 */
export function SmoothCaret({ textarea, deps = [] }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ta = textarea.current;
    const caret = ref.current;
    const parent = ta?.parentElement;
    if (!ta || !caret || !parent) return;

    // Espelho invisível no mesmo pai (mesmo zoom/escala): o texto até o cursor + um marcador.
    const mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    Object.assign(mirror.style, {
      position: "absolute",
      top: "0",
      left: "0",
      height: "0",
      overflow: "hidden",
      visibility: "hidden",
      pointerEvents: "none",
      boxSizing: "border-box",
      border: "0",
    });
    const marker = document.createElement("span");
    parent.appendChild(mirror);

    let frame = 0;
    let last = { x: NaN, y: NaN };
    let lastScroll = { x: ta.scrollLeft, y: ta.scrollTop };

    const hide = () => {
      caret.classList.remove("visible");
      last = { x: NaN, y: NaN };
    };

    const update = () => {
      frame = 0;
      const { selectionStart: start, selectionEnd: end, value } = ta;
      if (document.activeElement !== ta || start !== end) return hide();

      const cs = getComputedStyle(ta);
      for (const p of MIRROR_PROPS) mirror.style[p] = cs[p];
      mirror.style.width = `${ta.clientWidth}px`;
      mirror.textContent = value.slice(0, end);
      // A palavra seguinte entra no marcador para a quebra de linha sair igual à do textarea.
      marker.textContent = /^\S*/.exec(value.slice(end))![0] || "​";
      mirror.appendChild(marker);

      const fontSize = parseFloat(cs.fontSize);
      const h = fontSize * 1.2;
      const x = ta.offsetLeft + ta.clientLeft + marker.offsetLeft - ta.scrollLeft;
      const y = ta.offsetTop + ta.clientTop + marker.offsetTop + (marker.offsetHeight - h) / 2 - ta.scrollTop;

      // Fora da área visível do textarea (rolou para longe): esconde.
      const top = ta.offsetTop + ta.clientTop;
      const left = ta.offsetLeft + ta.clientLeft;
      const inView = y + h > top && y < top + ta.clientHeight && x >= left - 1 && x <= left + ta.clientWidth + 1;
      if (!inView) return hide();

      // Rolagem ou primeira aparição: pula direto (sem deslizar).
      const scrolled = ta.scrollLeft !== lastScroll.x || ta.scrollTop !== lastScroll.y;
      lastScroll = { x: ta.scrollLeft, y: ta.scrollTop };
      caret.classList.toggle("instant", scrolled || Number.isNaN(last.x));

      caret.style.width = `${Math.max(1.5, fontSize * 0.09)}px`;
      caret.style.height = `${h}px`;
      caret.style.background = cs.color;
      caret.style.transform = `translate(${x}px, ${y}px)`;

      // Moveu: fica aceso e recomeça a piscar.
      if (x !== last.x || y !== last.y) {
        caret.style.animation = "none";
        void caret.offsetWidth;
        caret.style.animation = "";
      }
      last = { x, y };
      caret.classList.add("visible");
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const events = ["input", "keydown", "keyup", "pointerdown", "pointerup", "select", "scroll", "focus", "blur"];
    for (const ev of events) ta.addEventListener(ev, schedule);
    document.addEventListener("selectionchange", schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(ta);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      for (const ev of events) ta.removeEventListener(ev, schedule);
      document.removeEventListener("selectionchange", schedule);
      ro.disconnect();
      mirror.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` vem de quem usa
  }, [textarea, ...deps]);

  return <div ref={ref} className="smooth-caret" aria-hidden="true" />;
}
