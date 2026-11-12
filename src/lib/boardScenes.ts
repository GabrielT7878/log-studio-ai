// Cenas dos Quadros (Excalidraw): carregadas do arquivo do projeto
// (`.logstudio/quadros/<id>.excalidraw`), guardadas em memória e salvas com uma pequena
// espera. Quem mostra o quadro (prévia/editor) assina para saber de mudanças de fora
// (ex.: o agente desenhou). Sem importar o Excalidraw (módulo leve).

import { api } from "./api";

/** Elemento do Excalidraw (tipado só no que usamos aqui). */
export interface BoardElement {
  id: string;
  isDeleted?: boolean;
  [key: string]: unknown;
}

export interface BoardScene {
  elements: readonly BoardElement[];
  files: Record<string, unknown>;
  scrollX: number;
  scrollY: number;
  zoom: number;
  viewBackgroundColor: string;
}

const SAVE_DELAY_MS = 800;

export const emptyScene = (): BoardScene => ({
  elements: [],
  files: {},
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  // Branco: no tema escuro o Excalidraw inverte as cores (aparece escuro).
  viewBackgroundColor: "#ffffff",
});

type Ref = { space: string; projectId: string; id: string };
const keyOf = (r: Ref) => `${r.space}\n${r.projectId}\n${r.id}`;

const cache = new Map<string, BoardScene>();
const loading = new Map<string, Promise<BoardScene>>();
const listeners = new Map<string, Set<(scene: BoardScene) => void>>();
const pending = new Map<string, { ref: Ref; timer: number }>();

/** Caminho do arquivo do quadro, relativo ao projeto. */
export const boardPath = (id: string) => `.logstudio/quadros/${id}.excalidraw`;

function fromFile(json: string): BoardScene {
  const data = JSON.parse(json) as {
    elements?: BoardElement[];
    files?: Record<string, unknown>;
    appState?: { scrollX?: number; scrollY?: number; zoom?: { value?: number }; viewBackgroundColor?: string };
  };
  const base = emptyScene();
  return {
    elements: Array.isArray(data.elements) ? data.elements : [],
    files: data.files && typeof data.files === "object" ? data.files : {},
    scrollX: data.appState?.scrollX ?? base.scrollX,
    scrollY: data.appState?.scrollY ?? base.scrollY,
    zoom: data.appState?.zoom?.value ?? base.zoom,
    viewBackgroundColor: data.appState?.viewBackgroundColor ?? base.viewBackgroundColor,
  };
}

/** Formato padrão do Excalidraw (abre também no excalidraw.com). */
function toFile(scene: BoardScene): string {
  const elements = scene.elements.filter((e) => !e.isDeleted);
  const used = new Set(elements.map((e) => e.fileId).filter(Boolean) as string[]);
  const files = Object.fromEntries(Object.entries(scene.files).filter(([id]) => used.has(id)));
  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "log-studio-ai",
      elements,
      appState: {
        viewBackgroundColor: scene.viewBackgroundColor,
        scrollX: scene.scrollX,
        scrollY: scene.scrollY,
        zoom: { value: scene.zoom },
      },
      files,
    },
    null,
    2,
  );
}

/** Cena já carregada (sem esperar). */
export function cachedScene(r: Ref): BoardScene | undefined {
  return cache.get(keyOf(r));
}

/** Carrega a cena do disco (uma vez; depois vem da memória). Arquivo ausente = quadro vazio. */
export function loadScene(r: Ref): Promise<BoardScene> {
  const key = keyOf(r);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(key);
  if (!p) {
    p = api
      .boardLoad(r.space, r.projectId, r.id)
      .then((json) => {
        const scene = json ? fromFile(json) : emptyScene();
        if (!cache.has(key)) cache.set(key, scene);
        return cache.get(key)!;
      })
      .finally(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

function flushKey(key: string) {
  const job = pending.get(key);
  if (!job) return;
  window.clearTimeout(job.timer);
  pending.delete(key);
  const scene = cache.get(key);
  if (scene) api.boardSave(job.ref.space, job.ref.projectId, job.ref.id, toFile(scene)).catch((e) => console.warn(e));
}

/**
 * Troca a cena e agenda o salvamento. `notify`: avisa prévia/editor (mudança vinda de fora
 * do editor, ex.: agente). `immediate`: salva já.
 */
export function setScene(r: Ref, scene: BoardScene, opts: { notify?: boolean; immediate?: boolean } = {}) {
  const key = keyOf(r);
  cache.set(key, scene);
  const old = pending.get(key);
  if (old) window.clearTimeout(old.timer);
  pending.set(key, { ref: r, timer: window.setTimeout(() => flushKey(key), SAVE_DELAY_MS) });
  if (opts.immediate) flushKey(key);
  if (opts.notify) listeners.get(key)?.forEach((fn) => fn(scene));
}

/** Salva já o que estiver pendente (de um quadro ou de todos). */
export function flushScene(r?: Ref) {
  if (r) flushKey(keyOf(r));
  else [...pending.keys()].forEach(flushKey);
}

/** Avisa quando a cena muda por fora do editor. Devolve o cancelamento. */
export function subscribeScene(r: Ref, fn: (scene: BoardScene) => void): () => void {
  const key = keyOf(r);
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

/** Quadro excluído: esquece a cena (o arquivo vai para a Lixeira pelo backend). */
export function forgetScene(r: Ref) {
  const key = keyOf(r);
  const job = pending.get(key);
  if (job) window.clearTimeout(job.timer);
  pending.delete(key);
  cache.delete(key);
}

// Fechar/recarregar o app: tenta salvar o que estiver pendente.
window.addEventListener("beforeunload", () => flushScene());
