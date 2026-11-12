import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasView } from "./useWorkspaceTree";

// Limites e níveis de zoom
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 3;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const WHEEL_ZOOM_SPEED = 0.0015; // Ctrl+roda / pinça
const BUTTON_ANIM_MS = 200;
const SCRUB_SPEED = 0.005; // arrastar no "100%": ~2,7× a cada 200px
// Centralizar uma janela (lista de janelas): margens e zoom máximo do ajuste.
const FIT_MARGIN_X = 60;
const FIT_MARGIN_Y = 110;
const FIT_MAX_ZOOM = 1;
const SCRUB_THRESHOLD = 3; // px até contar como arraste (abaixo disso é clique)
const SCRUB_MAX_STEP = 300; // px num só evento: acima disso é salto falso (ao travar o mouse), ignora

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/**
 * Visão do canvas: arrastar (pan) e zoom.
 * - Arrastar o fundo vazio move o canvas.
 * - Roda/touchpad rola; Ctrl+roda ou pinça dá zoom no ponto do cursor.
 * - Botões −/+ pulam entre níveis de zoom (centro da tela), com animação.
 * Posição e zoom ficam em variáveis CSS (--pan-x, --pan-y, --zoom), atualizadas
 * direto no elemento, sem re-renderizar o React a cada movimento.
 */
export function useCanvasPan(
  options: {
    onChange?: (view: CanvasView) => void;
    /** true = canvas parado (ex.: janela em tela cheia): roda e arraste não movem nem dão zoom. */
    locked?: () => boolean;
  } = {},
) {
  const ref = useRef<HTMLElement>(null);
  const view = useRef({ x: 0, y: 0, z: 1 });
  const [panning, setPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const animTimer = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;
  const lockedRef = useRef(options.locked);
  lockedRef.current = options.locked;

  /** Aplica a visão no elemento; `notify` avisa quem salva (mudanças do usuário). */
  const apply = useCallback((animate = false, notify = true) => {
    const el = ref.current;
    if (!el) return;
    if (notify) {
      const { x, y, z } = view.current;
      onChangeRef.current?.({ x, y, zoom: z });
    }
    if (animate) {
      el.classList.add("animating");
      window.clearTimeout(animTimer.current);
      animTimer.current = window.setTimeout(() => el.classList.remove("animating"), BUTTON_ANIM_MS);
    } else {
      el.classList.remove("animating");
    }
    const { x, y, z } = view.current;
    el.style.setProperty("--pan-x", `${x}px`);
    el.style.setProperty("--pan-y", `${y}px`);
    el.style.setProperty("--zoom", String(z));
  }, []);

  /** Zoom mantendo fixo o ponto (px, py), em coordenadas relativas ao canvas. */
  const zoomAt = useCallback(
    (nextZ: number, px: number, py: number, animate = false) => {
      const v = view.current;
      const z = clampZoom(nextZ);
      if (z === v.z) return;
      const k = z / v.z;
      v.x = px - (px - v.x) * k;
      v.y = py - (py - v.y) * k;
      v.z = z;
      apply(animate);
      setZoom(z);
    },
    [apply],
  );

  /** Zoom no centro da tela (botões com animação; arraste sem). */
  const zoomToCenter = useCallback(
    (nextZ: number, animate = true) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      zoomAt(nextZ, r.width / 2, r.height / 2, animate);
    },
    [zoomAt],
  );

  const zoomIn = useCallback(() => {
    const z = view.current.z;
    zoomToCenter(ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_MAX);
  }, [zoomToCenter]);

  const zoomOut = useCallback(() => {
    const z = view.current.z;
    zoomToCenter([...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_MIN);
  }, [zoomToCenter]);

  const resetZoom = useCallback(() => zoomToCenter(1), [zoomToCenter]);

  /** Define posição/zoom (ex.: ao abrir um projeto), sem animação e sem avisar `onChange`. */
  const setView = useCallback(
    (v: CanvasView) => {
      view.current = { x: v.x, y: v.y, z: clampZoom(v.zoom) };
      apply(false, false);
      setZoom(view.current.z);
    },
    [apply],
  );

  /**
   * Indicador de zoom ("100%"): arrastar na horizontal muda o zoom
   * (direita aumenta, esquerda diminui); clique sem arrastar volta para 100%.
   * Durante o arraste o mouse some e fica travado (Pointer Lock): dá para arrastar
   * sem limite, sem parar na borda do monitor. Ao soltar, o mouse volta onde estava.
   */
  const onZoomScrubStart = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const startZ = view.current.z;
      let lastX = e.clientX;
      let dx = 0; // arraste acumulado (px)
      let scrubbing = false;

      const onMove = (ev: PointerEvent) => {
        // Travado, a posição do mouse não muda: o deslocamento vem em `movementX`.
        const locked = document.pointerLockElement === el;
        const step = locked ? ev.movementX : ev.clientX - lastX;
        lastX = ev.clientX;
        // Ignora o salto falso que alguns navegadores mandam logo ao travar.
        if (Math.abs(step) > SCRUB_MAX_STEP) return;
        dx += step;
        if (!scrubbing) {
          if (Math.abs(dx) < SCRUB_THRESHOLD) return;
          scrubbing = true;
          document.documentElement.style.cursor = "ew-resize";
          try {
            Promise.resolve(el.requestPointerLock()).catch(() => undefined);
          } catch {
            // Sem Pointer Lock: segue com o mouse normal (para na borda da tela).
          }
        }
        zoomToCenter(startZ * Math.exp(dx * SCRUB_SPEED), false);
      };
      const finish = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onCancel);
        document.documentElement.style.cursor = "";
        if (document.pointerLockElement === el) document.exitPointerLock();
      };
      const onUp = () => {
        finish();
        if (!scrubbing) resetZoom(); // foi só um clique
      };
      const onCancel = finish;
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onCancel);
    },
    [zoomToCenter, resetZoom],
  );

  // Roda do mouse / touchpad (listener não-passivo para poder cancelar o padrão).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Linhas/páginas → pixels (alguns mouses informam em linhas).
    const wheelUnit = (e: WheelEvent) => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);

    // Ctrl+roda ou pinça no touchpad → zoom no cursor.
    const zoomByWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      const dy = e.deltaY * wheelUnit(e);
      zoomAt(view.current.z * Math.exp(-dy * WHEEL_ZOOM_SPEED), e.clientX - r.left, e.clientY - r.top);
    };

    const onWheel = (e: WheelEvent) => {
      if (lockedRef.current?.()) return;
      // Só sobre o fundo do canvas ou sobre os nós (não sobre a interface).
      const target = e.target as HTMLElement;
      // Dentro do terminal (ou do texto de uma nota), a roda rola o próprio conteúdo.
      // Ctrl + roda numa nota (não selecionada) dá zoom no canvas; a selecionada já tratou o evento.
      // Ctrl + roda num terminal não selecionado já foi tratado em `onWheelCapture`.
      if (target.closest(".term-body")) return;
      // Quadro selecionado: a roda (e Ctrl+roda) é do Excalidraw (zoom/rolagem dele).
      if (target.closest(".excalidraw")) return;
      if (!e.ctrlKey && target.closest(".note-text, .note-preview, .fb-scroll")) return;
      const overCanvas =
        target === el || !!target.closest(".canvas-world") || target.classList.contains("drag-region");
      if (!overCanvas) return;
      e.preventDefault();

      if (e.ctrlKey) {
        zoomByWheel(e);
        return;
      }

      const unit = wheelUnit(e);
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;

      // Rolagem: Shift+roda vira horizontal.
      const v = view.current;
      if (e.shiftKey && dx === 0) {
        v.x -= dy;
      } else {
        v.x -= dx;
        v.y -= dy;
      }
      apply();
    };

    // Ctrl + roda num terminal não selecionado: zoom no canvas.
    // Em captura, para o xterm não receber (nem consumir) o evento.
    const onWheelCapture = (e: WheelEvent) => {
      if (!e.ctrlKey || lockedRef.current?.()) return;
      const target = e.target as HTMLElement;
      if (!target.closest(".term-node:not(.selected)")) return;
      e.preventDefault();
      e.stopPropagation();
      zoomByWheel(e);
    };

    el.addEventListener("wheel", onWheelCapture, { passive: false, capture: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheelCapture, { capture: true });
      el.removeEventListener("wheel", onWheel);
    };
  }, [apply, zoomAt]);

  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  // Arrastar o fundo vazio (`force`: move mesmo começando em cima de um nó, ex.: Espaço + clique).
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, force = false) => {
      if (e.button !== 0 && e.button !== 1) return;
      if (lockedRef.current?.()) return;
      // Só no fundo vazio: o próprio canvas ou a camada do mundo (não em botões nem em nós).
      const target = e.target as HTMLElement;
      if (!force && target !== e.currentTarget && !target.classList.contains("canvas-world")) return;

      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX - view.current.x;
      const startY = e.clientY - view.current.y;
      setPanning(true);

      const onMove = (ev: PointerEvent) => {
        view.current.x = ev.clientX - startX;
        view.current.y = ev.clientY - startY;
        apply();
      };
      const onUp = () => {
        setPanning(false);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [apply],
  );

  /** Posição/zoom atuais (sem esperar o React). */
  /**
   * Desliza (animado) até o retângulo `r` (coordenadas do mundo) ficar no centro,
   * com o zoom ajustado para ele caber na tela (no máximo 100%).
   */
  const centerOn = useCallback(
    (r: { x: number; y: number; w: number; h: number }) => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      // Folga para as barras de cima e os controles de baixo.
      const availW = Math.max(100, box.width - 2 * FIT_MARGIN_X);
      const availH = Math.max(100, box.height - 2 * FIT_MARGIN_Y);
      const fit = Math.min(availW / Math.max(r.w, 1), availH / Math.max(r.h, 1));
      const z = clampZoom(Math.min(FIT_MAX_ZOOM, fit));
      view.current = { x: box.width / 2 - (r.x + r.w / 2) * z, y: box.height / 2 - (r.y + r.h / 2) * z, z };
      apply(true);
      setZoom(z);
    },
    [apply],
  );

  /** Vai até a posição/zoom `v`, animado (mudança do usuário: avisa `onChange`, que salva). */
  const goTo = useCallback(
    (v: CanvasView) => {
      view.current = { x: v.x, y: v.y, z: clampZoom(v.zoom) };
      apply(true);
      setZoom(view.current.z);
    },
    [apply],
  );

  const getView = useCallback((): CanvasView => {
    const { x, y, z } = view.current;
    return { x, y, zoom: z };
  }, []);

  return {
    ref,
    panning,
    onPointerDown,
    zoom,
    zoomIn,
    zoomOut,
    resetZoom,
    onZoomScrubStart,
    setView,
    getView,
    centerOn,
    goTo,
  };
}
