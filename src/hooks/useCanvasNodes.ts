import { useCallback, useEffect, useRef, useState } from "react";
import type { ActiveProject } from "../components/Canvas";
import { api } from "../lib/api";
import { sanitizeNodes, type CanvasNodeData } from "../lib/canvasNodes";

const SAVE_DELAY_MS = 400;

/**
 * Cards do canvas do projeto aberto. Mudanças são salvas no disco depois de uma
 * pausa (e na hora ao trocar de projeto). Mantém um cache por projeto nesta sessão.
 */
export function useCanvasNodes(project: ActiveProject | null) {
  const key = project ? `${project.space}\n${project.id}` : null;
  const projectRef = useRef(project);
  projectRef.current = project;

  const cache = useRef(new Map<string, CanvasNodeData[]>());
  const nodesRef = useRef<CanvasNodeData[]>([]);
  const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
  const pending = useRef<{ space: string; id: string; nodes: CanvasNodeData[] } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p) api.saveProjectCanvas(p.space, p.id, p.nodes).catch((e) => console.warn(e));
  }, []);

  // Trocou de projeto: salva o anterior e carrega os cards do novo.
  useEffect(() => {
    flush();
    const p = projectRef.current;
    const next = key ? (cache.current.get(key) ?? sanitizeNodes(p?.canvas)) : [];
    nodesRef.current = next;
    setNodes(next);
  }, [key, flush]);

  useEffect(() => flush, [flush]);

  /** Altera os cards do projeto aberto (e agenda o salvamento). */
  const update = useCallback(
    (fn: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => {
      const p = projectRef.current;
      if (!p) return;
      const next = fn(nodesRef.current);
      nodesRef.current = next;
      setNodes(next);
      cache.current.set(`${p.space}\n${p.id}`, next);
      pending.current = { space: p.space, id: p.id, nodes: next };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  return { nodes, update };
}
