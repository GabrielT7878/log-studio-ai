// Excalidraw de uma janela "Quadro". Módulo carregado sob demanda (React.lazy):
// o Excalidraw e o CSS dele só são baixados quando algum quadro aparece.
//
// Na janela do canvas o quadro é só uma prévia (imagem do desenho, sem interação);
// para editar, a janela vai para tela cheia — sempre a 100%, sem misturar o zoom do
// canvas com o zoom do Excalidraw.
//
// O desenho fica em `<projeto>/.logstudio/quadros/<id>.excalidraw` (src/lib/boardScenes.ts).
import {
  bumpVersion,
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  restoreElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import { PenTool } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cachedScene,
  emptyScene,
  flushScene,
  loadScene,
  setScene,
  subscribeScene,
  type BoardElement,
  type BoardScene,
} from "../lib/boardScenes";

// Fontes servidas pelo próprio app (public/excalidraw/fonts), sem CDN: funciona offline.
(window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = `${window.location.origin}/excalidraw/`;

type OnChange = NonNullable<ExcalidrawProps["onChange"]>;
type Elements = Parameters<OnChange>[0];
type Skeletons = Parameters<typeof convertToExcalidrawElements>[0];

/** Descrição simples (formas, textos, setas) → elementos do Excalidraw (ids informados são mantidos). */
export function convertSkeletons(skeletons: unknown[]): BoardElement[] {
  return convertToExcalidrawElements(skeletons as Skeletons, { regenerateIds: false }) as unknown as BoardElement[];
}

interface SceneRef {
  space: string;
  projectId: string;
  id: string;
}

interface Props extends SceneRef {
  /** true = editor (janela em tela cheia); false = prévia na janela do canvas. */
  editing: boolean;
  /** Pedido para editar (vai para tela cheia). */
  onEdit: () => void;
}

export default function ExcalidrawBoard({ space, projectId, id, editing, onEdit }: Props) {
  const ref = useMemo(() => ({ space, projectId, id }), [space, projectId, id]);
  const [ready, setReady] = useState(() => !!cachedScene(ref));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadScene(ref)
      .then(() => alive && setReady(true))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [ref]);

  if (error) return <div className="bd-loading">{error}</div>;
  if (!ready) return <div className="bd-loading">Carregando quadro…</div>;
  return editing ? <Editor sceneRef={ref} /> : <Preview sceneRef={ref} onEdit={onEdit} />;
}

/** Excalidraw interativo (só em tela cheia: a 100%, com zoom e rolagem próprios). */
function Editor({ sceneRef }: { sceneRef: SceneRef }) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [saved] = useState(() => cachedScene(sceneRef) ?? emptyScene());

  const onChange: OnChange = (elements, appState, files) => {
    setScene(sceneRef, {
      elements: elements as unknown as BoardElement[],
      files: files as unknown as Record<string, unknown>,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom.value,
      viewBackgroundColor: appState.viewBackgroundColor,
    });
  };

  // Mudança de fora (ex.: o agente desenhou): entra no editor e no histórico (Ctrl+Z dele).
  useEffect(
    () =>
      subscribeScene(sceneRef, (scene) => {
        const api = apiRef.current;
        if (!api) return;
        api.addFiles(Object.values(scene.files) as BinaryFileData[]);
        api.updateScene({
          elements: scene.elements as unknown as Elements,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      }),
    [sceneRef],
  );

  // Saindo da tela cheia: salva já.
  useEffect(() => () => flushScene(sceneRef), [sceneRef]);

  // O Excalidraw guarda a posição dele na tela para calcular o mouse: atualiza ao entrar.
  const refresh = () => apiRef.current?.refresh();

  return (
    <div className="bd-excalidraw" onPointerEnter={refresh} onPointerDownCapture={refresh}>
      <Excalidraw
        excalidrawAPI={(api) => (apiRef.current = api)}
        theme="dark"
        langCode="pt-BR"
        autoFocus
        initialData={{
          elements: saved.elements as unknown as Elements,
          files: saved.files as unknown as BinaryFiles,
          appState: {
            scrollX: saved.scrollX,
            scrollY: saved.scrollY,
            zoom: { value: saved.zoom as NormalizedZoomValue },
            viewBackgroundColor: saved.viewBackgroundColor,
          },
        }}
        onChange={onChange}
        UIOptions={{
          canvasActions: {
            // O arquivo é do app: sem "Abrir", "Salvar em arquivo" nem trocar tema.
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
            export: false,
            saveAsImage: true,
          },
        }}
      />
    </div>
  );
}

/** Prévia: imagem (SVG) do desenho, ajustada à janela, + botão para editar em tela cheia. */
function Preview({ sceneRef, onEdit }: { sceneRef: SceneRef; onEdit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scene, setLocal] = useState<BoardScene>(() => cachedScene(sceneRef) ?? emptyScene());
  const elements = useMemo(() => scene.elements.filter((e) => !e.isDeleted), [scene]);

  // Mudança de fora (ex.: o agente desenhou): refaz a prévia.
  useEffect(() => subscribeScene(sceneRef, setLocal), [sceneRef]);

  useEffect(() => {
    if (elements.length === 0) return;
    let alive = true;
    exportToSvg({
      elements: elements as unknown as Elements,
      files: scene.files as unknown as BinaryFiles,
      appState: { exportBackground: false, exportWithDarkMode: true, viewBackgroundColor: scene.viewBackgroundColor },
      exportPadding: 16,
    })
      // (os tipos do exportToSvg não resolvem fora do monorepo do Excalidraw: anotados aqui)
      .then((svg: SVGSVGElement) => {
        if (!alive || !ref.current) return;
        // Sem tamanho fixo: o CSS ajusta à janela mantendo a proporção.
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        ref.current.replaceChildren(svg);
      })
      .catch((e: unknown) => console.warn("Prévia do quadro:", e));
    return () => {
      alive = false;
    };
  }, [scene, elements]);

  return (
    <div className="bd-preview">
      {elements.length === 0 ? <div className="bd-empty">Quadro vazio</div> : <div ref={ref} className="bd-preview-img" />}
      <button
        className="bd-edit-btn"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        <PenTool size={13} />
        Editar em tela cheia
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edição pelo agente: alterar/remover elementos, descrever e "fotografar" o quadro.
// ---------------------------------------------------------------------------

/** Elemento do Excalidraw com os campos usados aqui (o resto é preservado). */
type El = BoardElement & {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  originalText?: string;
  fontSize?: number;
  containerId?: string | null;
  boundElements?: { id: string; type: string }[] | null;
  startBinding?: { elementId: string; focus?: number; gap?: number } | null;
  endBinding?: { elementId: string; focus?: number; gap?: number } | null;
  points?: [number, number][];
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
};

export interface ElementPatch {
  id: string;
  x?: number;
  y?: number;
  /** Setas/linhas: pontos relativos a (x, y). */
  points?: [number, number][];
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  strokeColor?: string;
  backgroundColor?: string;
}

const FILLABLE = new Set(["rectangle", "ellipse", "diamond"]);
const isLinear = (e: El) => e.type === "arrow" || e.type === "line";
const centerOf = (e: El) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
const boundTextOf = (els: El[], c: El) => els.find((e) => e.type === "text" && e.containerId === c.id && !e.isDeleted);
type Restorable = Parameters<typeof restoreElements>[0];

/** Ponto na borda da forma `s`, na direção de `toward` (com uma pequena folga, como o Excalidraw). */
function edgePoint(s: El, toward: { x: number; y: number }, gap = 6) {
  const c = centerOf(s);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return c;
  const rx = Math.max(s.width / 2, 1);
  const ry = Math.max(s.height / 2, 1);
  const t =
    s.type === "ellipse"
      ? 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
      : s.type === "diamond"
        ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
        : Math.min(rx / Math.abs(dx || 1e-9), ry / Math.abs(dy || 1e-9));
  return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap };
}

function linearEnd(a: El) {
  const p = a.points?.[a.points.length - 1] ?? [a.width, a.height];
  return { x: a.x + p[0], y: a.y + p[1] };
}

/** Refaz a seta presa a formas (reta, da borda de uma à borda da outra). */
function rerouteArrow(a: El, map: Map<string, El>) {
  const s = a.startBinding ? map.get(a.startBinding.elementId) : undefined;
  const t = a.endBinding ? map.get(a.endBinding.elementId) : undefined;
  if (!s && !t) return false;
  const start0 = { x: a.x, y: a.y };
  const end0 = linearEnd(a);
  const start = s ? edgePoint(s, t ? centerOf(t) : end0) : start0;
  const end = t ? edgePoint(t, s ? centerOf(s) : start0) : end0;
  a.x = start.x;
  a.y = start.y;
  a.points = [
    [0, 0],
    [end.x - start.x, end.y - start.y],
  ];
  a.width = Math.abs(end.x - start.x);
  a.height = Math.abs(end.y - start.y);
  return true;
}

/** Texto de uma forma/seta: centralizado (forma cresce na altura se o texto não couber). */
function placeLabel(t: El, c: El) {
  if (isLinear(c)) {
    const e = linearEnd(c);
    t.x = (c.x + e.x) / 2 - t.width / 2;
    t.y = (c.y + e.y) / 2 - t.height / 2;
    return;
  }
  if (t.height + 10 > c.height) c.height = t.height + 10;
  t.x = c.x + (c.width - t.width) / 2;
  t.y = c.y + (c.height - t.height) / 2;
}

/** Texto novo dentro de uma forma/seta que ainda não tinha. */
function newLabel(c: El, text: string, fontSize: number): El {
  const [t] = convertToExcalidrawElements(
    [{ type: "text", id: `${c.id}-t${Math.random().toString(36).slice(2, 7)}`, x: c.x, y: c.y, text, fontSize }] as Skeletons,
    { regenerateIds: false },
  ) as unknown as El[];
  return { ...t, containerId: c.id, textAlign: "center", verticalAlign: "middle" } as El;
}

/** Pontos de seta/linha relativos a (x, y); o primeiro passa a ser (0, 0). Atualiza largura/altura. */
function setPoints(e: El, points: [number, number][]) {
  const [ox, oy] = points[0];
  e.x += ox;
  e.y += oy;
  e.points = points.map(([px, py]) => [px - ox, py - oy] as [number, number]);
  const xs = e.points.map((q) => q[0]);
  const ys = e.points.map((q) => q[1]);
  e.width = Math.max(...xs) - Math.min(...xs);
  e.height = Math.max(...ys) - Math.min(...ys);
}

/** Refaz setas presas a formas (borda a borda) e reposiciona os rótulos delas. Devolve os ids alterados. */
function fixArrows(els: El[], only?: (a: El) => boolean): string[] {
  const byId = new Map(els.map((e) => [e.id, e]));
  const changed: string[] = [];
  for (const a of els) {
    if (!isLinear(a) || (only && !only(a))) continue;
    if (rerouteArrow(a, byId)) {
      changed.push(a.id);
      const t = boundTextOf(els, a);
      if (t) {
        placeLabel(t, a);
        changed.push(t.id);
      }
    }
  }
  return changed;
}

/** Setas (entre `arrowIds`) cujas duas formas se sobrepõem — a seta fica curta/dentro de uma delas. */
function overlappingArrows(els: El[], arrowIds: Set<string>): string[] {
  const byId = new Map(els.map((e) => [e.id, e]));
  const hit = (a: El, b: El) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  return els
    .filter((a) => isLinear(a) && arrowIds.has(a.id))
    .filter((a) => {
      const s = a.startBinding && byId.get(a.startBinding.elementId);
      const t = a.endBinding && byId.get(a.endBinding.elementId);
      return !!s && !!t && hit(s, t);
    })
    .map((a) => a.id);
}

/** Seta nova ligada a uma forma que já estava no quadro (from/to fora da chamada). */
export interface ArrowLink {
  arrowId: string;
  from?: string;
  to?: string;
}

/**
 * Acrescenta elementos (descrição simples → Excalidraw) a `existing`. Setas presas a formas
 * saem de borda a borda (a conversão do Excalidraw liga centro a centro e troca largura 0 por 100);
 * `links` liga setas novas a formas que já existiam.
 */
export function addElements(existing: readonly BoardElement[], skeletons: unknown[], links: ArrowLink[]) {
  const added = convertSkeletons(skeletons) as El[];
  const all = [...(existing.filter((e) => !e.isDeleted).map((e) => ({ ...e })) as El[]), ...added];
  const byId = new Map(all.map((e) => [e.id, e]));
  const touched = new Set(added.map((e) => e.id));

  for (const link of links) {
    const arrow = byId.get(link.arrowId);
    if (!arrow) continue;
    for (const [side, target] of [
      ["startBinding", link.from],
      ["endBinding", link.to],
    ] as const) {
      if (!target) continue;
      const shape = byId.get(target);
      if (!shape || isLinear(shape) || (shape.type === "text" && shape.containerId)) {
        throw new Error(`O elemento "${target}" não existe no quadro (ou não é uma forma). Veja os ids com board_snapshot.`);
      }
      arrow[side] = { elementId: shape.id, focus: 0, gap: 6 };
      if (!(shape.boundElements ?? []).some((b) => b.id === arrow.id)) {
        shape.boundElements = [...(shape.boundElements ?? []), { id: arrow.id, type: "arrow" }];
        touched.add(shape.id);
      }
    }
  }

  const newIds = new Set(added.map((e) => e.id));
  fixArrows(all, (a) => newIds.has(a.id)).forEach((id) => touched.add(id));
  for (const e of all) if (touched.has(e.id)) bumpVersion(e as unknown as Parameters<typeof bumpVersion>[0]);
  return { elements: all as BoardElement[], added: added.length, overlapping: overlappingArrows(all, newIds) };
}

/**
 * Desloca elementos em lote: os `ids` e/ou tudo cujo topo está em `belowY` ou abaixo.
 * Textos de dentro acompanham as formas; setas presas se ajustam; setas soltas selecionadas vão junto.
 */
export function moveElements(
  elements: readonly BoardElement[],
  sel: { ids?: string[]; belowY?: number },
  dx: number,
  dy: number,
) {
  const els = elements.filter((e) => !e.isDeleted).map((e) => ({ ...e })) as El[];
  const top = (e: El) => (isLinear(e) && e.points ? e.y + Math.min(...e.points.map((q) => q[1])) : e.y);
  const movable = (e: El) => !(e.type === "text" && e.containerId);
  const ids = new Set<string>();
  const missing: string[] = [];
  for (const id of sel.ids ?? []) {
    const e = els.find((x) => x.id === id);
    if (e && movable(e)) ids.add(id);
    else missing.push(id);
  }
  if (sel.belowY !== undefined) for (const e of els) if (movable(e) && top(e) >= sel.belowY) ids.add(e.id);

  const changed = new Set<string>();
  for (const e of els) {
    const inside = ids.has(e.id) || (e.type === "text" && !!e.containerId && ids.has(e.containerId));
    if (!inside) continue;
    e.x += dx;
    e.y += dy;
    changed.add(e.id);
  }
  fixArrows(els, (a) =>
    [a.startBinding?.elementId, a.endBinding?.elementId].some((id) => id !== undefined && changed.has(id)),
  ).forEach((id) => changed.add(id));
  for (const e of els) if (changed.has(e.id)) bumpVersion(e as unknown as Parameters<typeof bumpVersion>[0]);
  return { elements: els as BoardElement[], moved: [...ids], missing, overlapping: overlappingArrows(els, changed) };
}

/** Aplica alterações pelo id. Devolve os elementos novos, os ids alterados e os não encontrados. */
export function editElements(elements: readonly BoardElement[], patches: ElementPatch[]) {
  let els = elements.filter((e) => !e.isDeleted).map((e) => ({ ...e })) as El[];
  const map = new Map(els.map((e) => [e.id, e]));
  const changed = new Set<string>();
  const missing: string[] = [];

  for (const p of patches) {
    const e = map.get(p.id);
    // Texto preso a uma forma: altere pela forma.
    if (!e || (e.type === "text" && e.containerId)) {
      missing.push(p.id);
      continue;
    }
    if (p.x !== undefined) e.x = p.x;
    if (p.y !== undefined) e.y = p.y;
    if (isLinear(e) && p.points) setPoints(e, p.points);
    if (!isLinear(e) && e.type !== "text") {
      if (p.width !== undefined) e.width = Math.max(10, p.width);
      if (p.height !== undefined) e.height = Math.max(10, p.height);
    }
    if (p.strokeColor) e.strokeColor = p.strokeColor;
    if (p.backgroundColor && FILLABLE.has(e.type)) {
      e.backgroundColor = p.backgroundColor;
      if (p.backgroundColor !== "transparent") e.fillStyle = "solid";
    }
    if (e.type === "text") {
      if (p.text !== undefined) Object.assign(e, { text: p.text, originalText: p.text });
      if (p.fontSize !== undefined) e.fontSize = p.fontSize;
    } else if (p.text !== undefined || p.fontSize !== undefined || p.strokeColor) {
      let t = boundTextOf(els, e);
      if (!t && p.text) {
        t = newLabel(e, p.text, p.fontSize ?? 20);
        els.push(t);
        map.set(t.id, t);
        e.boundElements = [...(e.boundElements ?? []), { id: t.id, type: "text" }];
      }
      if (t) {
        if (p.text !== undefined) Object.assign(t, { text: p.text, originalText: p.text });
        if (p.fontSize !== undefined) t.fontSize = p.fontSize;
        if (p.strokeColor) t.strokeColor = p.strokeColor;
        changed.add(t.id);
      }
    }
    changed.add(e.id);
  }

  // Texto vazio numa forma: some.
  els = els.filter((e) => !(e.type === "text" && e.containerId && changed.has(e.id) && !e.text));

  // Mede e quebra os textos de novo (função oficial do Excalidraw) e conserta as ligações.
  els = restoreElements(els as unknown as Restorable, null, { refreshDimensions: true, repairBindings: true }) as unknown as El[];
  const byId = new Map(els.map((e) => [e.id, e]));

  for (const id of [...changed]) {
    const c = byId.get(id);
    if (!c || c.type === "text") continue;
    const t = boundTextOf(els, c);
    if (t) {
      placeLabel(t, c);
      changed.add(t.id);
    }
  }
  // Setas presas a formas alteradas acompanham.
  for (const a of els) {
    if (!isLinear(a)) continue;
    const touches = (a.startBinding && changed.has(a.startBinding.elementId)) || (a.endBinding && changed.has(a.endBinding.elementId));
    if (touches && rerouteArrow(a, byId)) {
      changed.add(a.id);
      const t = boundTextOf(els, a);
      if (t) {
        placeLabel(t, a);
        changed.add(t.id);
      }
    }
  }
  for (const e of els) if (changed.has(e.id)) bumpVersion(e as unknown as Parameters<typeof bumpVersion>[0]);
  return { elements: els as BoardElement[], changed: [...changed], missing };
}

/** Remove elementos pelo id, com os textos presos a eles e as setas ligadas a eles. */
export function removeElements(elements: readonly BoardElement[], ids: string[]) {
  const els = elements.filter((e) => !e.isDeleted) as El[];
  const remove = new Set(ids.filter((id) => els.some((e) => e.id === id)));
  const found = [...remove];
  for (const e of els) {
    if (isLinear(e) && ((e.startBinding && remove.has(e.startBinding.elementId)) || (e.endBinding && remove.has(e.endBinding.elementId)))) {
      remove.add(e.id);
    }
  }
  for (const e of els) if (e.type === "text" && e.containerId && remove.has(e.containerId)) remove.add(e.id);
  const kept = els
    .filter((e) => !remove.has(e.id))
    .map((e) => (e.boundElements ? { ...e, boundElements: e.boundElements.filter((b) => !remove.has(b.id)) } : e));
  const next = restoreElements(kept as unknown as Restorable, null, { repairBindings: true }) as unknown as BoardElement[];
  return { elements: next, removed: [...remove], found };
}

/** Lista legível dos elementos (para o agente achar o que corrigir). Textos de formas vêm dentro delas. */
export function describeElements(elements: readonly BoardElement[]) {
  const els = elements.filter((e) => !e.isDeleted) as El[];
  const r = (v: number) => Math.round(v);
  return els
    .filter((e) => !(e.type === "text" && e.containerId))
    .slice(0, 500)
    .map((e) => {
      const label = e.type === "text" ? e.text : boundTextOf(els, e)?.text;
      return {
        id: e.id,
        type: e.type,
        x: r(e.x),
        y: r(e.y),
        ...(isLinear(e) && e.points
          ? { points: e.points.map(([px, py]) => [r(px), r(py)]) }
          : { width: r(e.width), height: r(e.height) }),
        ...(label ? { text: label } : {}),
        ...(e.startBinding ? { from: e.startBinding.elementId } : {}),
        ...(e.endBinding ? { to: e.endBinding.elementId } : {}),
        ...(e.strokeColor ? { strokeColor: e.strokeColor } : {}),
        ...(e.backgroundColor && e.backgroundColor !== "transparent" ? { backgroundColor: e.backgroundColor } : {}),
      };
    });
}

/** PNG (base64) do quadro como o usuário vê (tema escuro), com o maior lado limitado. */
export async function snapshotPng(scene: BoardScene, maxSize = 1600): Promise<string> {
  const elements = scene.elements.filter((e) => !e.isDeleted);
  const blob: Blob = await exportToBlob({
    elements: elements as unknown as Elements,
    files: scene.files as unknown as BinaryFiles,
    appState: { exportBackground: true, exportWithDarkMode: true, viewBackgroundColor: scene.viewBackgroundColor },
    mimeType: "image/png",
    maxWidthOrHeight: maxSize,
    exportPadding: 24,
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
