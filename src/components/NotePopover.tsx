import { Check, Minus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { scrubNumber } from "../lib/scrub";
import {
  NOTE_COLORS,
  NOTE_PALETTE,
  NOTE_FONT_MAX,
  NOTE_FONT_MIN,
  SUGGESTED_FONTS,
  TEXT_COLORS,
  noteFontFamily,
} from "../lib/canvasNodes";

const MARGIN = 8;

/**
 * Painel flutuante abaixo de um botão da barra da nota.
 * Fecha ao clicar fora ou com Esc (o botão que o abriu cuida de alternar).
 */
export function NotePopover({
  x,
  y,
  closing,
  onClose,
  className = "",
  children,
}: {
  x: number;
  y: number;
  closing: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Mantém o painel dentro da janela.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    if (closing) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [closing, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`ctx-menu note-popover ${className}${closing ? " closing" : ""}`}
      style={{ left: pos.x, top: pos.y }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Conteúdos
// ---------------------------------------------------------------------------

/** 🎨 Cores da nota: grade da paleta + cor livre (arco-íris). */
export function ColorPicker({
  current,
  onPick,
  onCustom,
}: {
  current: string;
  /** Cor da paleta (fecha o painel). */
  onPick: (c: string) => void;
  /** Cor livre, ao vivo enquanto escolhe. */
  onCustom: (hex: string) => void;
}) {
  const custom = current.startsWith("#");
  return (
    <div className="np-color-grid">
      {NOTE_PALETTE.map((key) => (
        <button
          key={key}
          className={`np-swatch${key === current ? " selected" : ""}`}
          title={NOTE_COLORS[key].label}
          style={{ background: NOTE_COLORS[key].bg }}
          onClick={() => onPick(key)}
        />
      ))}
      <label
        className={`np-swatch np-swatch-custom${custom ? " selected" : ""}`}
        title="Cor personalizada"
      >
        <input
          type="color"
          value={custom ? current : "#ffffff"}
          onInput={(e) => onCustom(e.currentTarget.value)}
          onChange={(e) => onCustom(e.currentTarget.value)}
        />
      </label>
    </div>
  );
}

/** Cores do texto: grade (7 por linha) + cor livre (arco-íris). */
export function TextColorPicker({
  current,
  onPick,
  onCustom,
}: {
  current: string;
  onPick: (c: string) => void;
  onCustom: (hex: string) => void;
}) {
  const inPalette = TEXT_COLORS.some((c) => c.toLowerCase() === current.toLowerCase());
  return (
    <div className="np-color-grid np-color-grid-7">
      {TEXT_COLORS.map((c) => (
        <button
          key={c}
          className={`np-swatch${c.toLowerCase() === current.toLowerCase() ? " selected" : ""}`}
          title={c}
          style={{ background: c }}
          onClick={() => onPick(c)}
        />
      ))}
      <label className={`np-swatch np-swatch-custom${inPalette ? "" : " selected"}`} title="Cor personalizada">
        <input
          type="color"
          value={current}
          onInput={(e) => onCustom(e.currentTarget.value)}
          onChange={(e) => onCustom(e.currentTarget.value)}
        />
      </label>
    </div>
  );
}

/** A↑ Tamanho da fonte: − valor + */
export function FontSizeStepper({ size, onChange }: { size: number; onChange: (size: number) => void }) {
  const set = (v: number) => onChange(Math.min(NOTE_FONT_MAX, Math.max(NOTE_FONT_MIN, v)));
  return (
    <div className="np-stepper">
      <button className="icon-btn" title="Diminuir" disabled={size <= NOTE_FONT_MIN} onClick={() => set(size - 1)}>
        <Minus size={15} />
      </button>
      <span
        className="np-stepper-value scrub-value"
        title="Arraste para os lados para ajustar"
        onPointerDown={(e) =>
          scrubNumber(e, size, onChange, { min: NOTE_FONT_MIN, max: NOTE_FONT_MAX, pxPerUnit: 6 })
        }
      >
        {size}
      </span>
      <button className="icon-btn" title="Aumentar" disabled={size >= NOTE_FONT_MAX} onClick={() => set(size + 1)}>
        <Plus size={15} />
      </button>
    </div>
  );
}

/** # Títulos 1–3. */
export function HeadingMenu({ onPick }: { onPick: (level: 1 | 2 | 3) => void }) {
  return (
    <>
      {([1, 2, 3] as const).map((level) => (
        <button key={level} className={`ctx-item np-heading-item np-h${level}`} onClick={() => onPick(level)}>
          <span className="np-hash">{"#".repeat(level)}</span>
          <span>Título {level}</span>
        </button>
      ))}
    </>
  );
}

// Fontes instaladas: busca uma vez e guarda.
let fontsCache: string[] | null = null;
let fontsPromise: Promise<string[]> | null = null;
function loadFonts() {
  fontsPromise ??= api
    .listFonts()
    .then((list) => (fontsCache = list))
    .catch(() => (fontsCache = []));
  return fontsPromise;
}

/** Aa Seletor de fonte: busca + Padrão + Sugeridas + Todas as fontes (cada uma na própria fonte). */
export function FontPicker({ current, onPick }: { current: string; onPick: (font: string) => void }) {
  const [query, setQuery] = useState("");
  const [installed, setInstalled] = useState<string[]>(fontsCache ?? []);

  useEffect(() => {
    let alive = true;
    loadFonts().then((list) => alive && setInstalled(list));
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);
  const isInstalled = (name: string) => installed.length === 0 || installed.includes(name);
  const suggested = SUGGESTED_FONTS.filter((f) => isInstalled(f) && matches(f));
  const others = installed.filter((f) => !SUGGESTED_FONTS.includes(f) && matches(f));
  const showDefault = matches("padrão monoespaçada");
  const first = showDefault ? "" : (suggested[0] ?? others[0]);

  const item = (font: string, label = font) => (
    <button
      key={font || "padrao"}
      className="ctx-item np-font-item"
      style={{ fontFamily: noteFontFamily(font) }}
      onClick={() => onPick(font)}
    >
      <span className="ctx-label">{label}</span>
      {font === current && <Check size={14} className="np-check" />}
    </button>
  );

  return (
    <>
      <input
        className="np-search"
        placeholder="Buscar fontes"
        value={query}
        autoFocus
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && first !== undefined) onPick(first);
        }}
      />
      <div className="np-font-list">
        {showDefault && item("", "Padrão (monoespaçada)")}
        {suggested.length > 0 && <div className="np-section">SUGERIDAS</div>}
        {suggested.map((f) => item(f))}
        {others.length > 0 && <div className="np-section">TODAS AS FONTES</div>}
        {others.map((f) => item(f))}
        {!showDefault && suggested.length === 0 && others.length === 0 && (
          <div className="np-empty">Nenhuma fonte encontrada</div>
        )}
      </div>
    </>
  );
}
