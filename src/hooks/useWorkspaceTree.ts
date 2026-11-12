import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { DropTarget } from "./useTreeDrag";

// Árvore da sidebar (do espaço de trabalho selecionado). A fonte de verdade é o
// backend (diretórios reais); cada operação devolve a árvore atualizada.
// O `id` de cada item é o caminho relativo ao espaço (ex.: "Pasta/Projeto").
/** Posição e zoom do canvas de um projeto. */
export interface CanvasView {
  x: number;
  y: number;
  zoom: number;
  /** Id da janela em tela cheia (null/ausente = nenhuma). */
  fullscreen?: string | null;
}

export interface ProjectNode {
  kind: "project";
  id: string;
  name: string;
  color: string;
  /** Projeto aberto no canvas (no máximo um por espaço). */
  active?: boolean;
  /** Posição/zoom salvos do canvas. */
  view?: CanvasView;
  /** Cards salvos do canvas (validados ao carregar, em canvasNodes.ts). */
  canvas?: unknown;
}

export interface FolderNode {
  kind: "folder";
  id: string;
  name: string;
  expanded: boolean;
  children: TreeNode[];
}

export type TreeNode = FolderNode | ProjectNode;

export function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kind === "folder") {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Projeto marcado como aberto no canvas. */
export function findActiveProject(nodes: TreeNode[]): ProjectNode | undefined {
  for (const n of nodes) {
    if (n.kind === "project" && n.active) return n;
    if (n.kind === "folder") {
      const found = findActiveProject(n.children);
      if (found) return found;
    }
  }
  return undefined;
}

function setActiveLocal(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes.map((n) =>
    n.kind === "folder"
      ? { ...n, children: setActiveLocal(n.children, id) }
      : { ...n, active: n.id === id },
  );
}

function setExpandedLocal(nodes: TreeNode[], id: string, expanded: boolean): TreeNode[] {
  return nodes.map((n) => {
    if (n.kind !== "folder") return n;
    if (n.id === id) return { ...n, expanded };
    return { ...n, children: setExpandedLocal(n.children, id, expanded) };
  });
}

/**
 * @param space espaço de trabalho selecionado (null enquanto carrega).
 * @param rootVersion muda quando o diretório raiz é trocado → recarrega a árvore.
 * @param onError recebe a mensagem de erro do backend.
 */
export function useWorkspaceTree(
  space: string | null,
  rootVersion: number,
  onError: (msg: string) => void,
) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Item cujo nome está sendo editado inline.
  const [editingId, setEditingId] = useState<string | null>(null);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // Espaço atual, para descartar respostas que chegam depois de trocar de espaço.
  const spaceRef = useRef(space);
  spaceRef.current = space;

  /** Executa a chamada no espaço `s`; ignora a resposta se o espaço mudou no meio. */
  const attempt = useCallback(async <T,>(s: string, call: Promise<T>): Promise<T | undefined> => {
    try {
      const result = await call;
      return spaceRef.current === s ? result : undefined;
    } catch (e) {
      onErrorRef.current(String(e));
      return undefined;
    }
  }, []);

  // Carrega ao trocar de espaço (ou de raiz).
  useEffect(() => {
    setLoaded(false);
    setEditingId(null);
    if (!space) return;
    let alive = true;
    attempt(space, api.loadTree(space)).then((t) => {
      if (!alive || !t) return;
      setTree(t);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [space, rootVersion, attempt]);

  const createFolder = useCallback(
    async (parentId: string | null) => {
      if (!space) return;
      const r = await attempt(space, api.createFolder(space, parentId));
      if (!r) return;
      setTree(r.tree);
      setEditingId(r.id);
    },
    [space, attempt],
  );

  const createProject = useCallback(
    async (parentId: string | null) => {
      if (!space) return;
      const r = await attempt(space, api.createProject(space, parentId));
      if (!r) return;
      setTree(r.tree);
      setEditingId(r.id);
    },
    [space, attempt],
  );

  /** Coloca o nome do item em modo de edição inline. */
  const startRename = useCallback((id: string) => setEditingId(id), []);

  /** Confirma a edição do nome. `name === null` cancela (mantém o nome atual). */
  const rename = useCallback(
    async (id: string, name: string | null) => {
      setEditingId(null);
      const clean = name?.trim();
      if (!clean || !space) return;
      const t = await attempt(space, api.rename(space, id, clean));
      if (t) setTree(t);
    },
    [space, attempt],
  );

  /** Abre/fecha na hora (otimista) e salva no backend. */
  const toggleFolder = useCallback(
    (id: string) => {
      const node = findNode(tree, id);
      if (!node || node.kind !== "folder" || !space) return;
      const expanded = !node.expanded;
      setTree((t) => setExpandedLocal(t, id, expanded));
      void attempt(space, api.setExpanded(space, id, expanded));
    },
    [tree, space, attempt],
  );

  /** Move o item para a Lixeira. */
  const deleteNode = useCallback(
    async (id: string) => {
      if (!space) return;
      const t = await attempt(space, api.remove(space, id));
      if (t) setTree(t);
    },
    [space, attempt],
  );

  /** Reordena ou muda de pasta (move o diretório no disco). */
  const moveNode = useCallback(
    async (dragId: string, target: DropTarget) => {
      if (!space) return;
      const t = await attempt(space, api.move(space, dragId, target.id, target.pos));
      if (t) setTree(t);
    },
    [space, attempt],
  );

  /** Abre o projeto no canvas (na hora, otimista) e salva no backend. */
  const selectProject = useCallback(
    (id: string) => {
      if (!space) return;
      setTree((t) => setActiveLocal(t, id));
      void attempt(space, api.setActiveProject(space, id));
    },
    [space, attempt],
  );

  const openInExplorer = useCallback(
    (id: string) => {
      if (!space) return;
      void attempt(space, api.openInExplorer(space, id));
    },
    [space, attempt],
  );

  return {
    tree,
    loaded,
    editingId,
    createFolder,
    createProject,
    startRename,
    rename,
    toggleFolder,
    deleteNode,
    moveNode,
    selectProject,
    openInExplorer,
  };
}
