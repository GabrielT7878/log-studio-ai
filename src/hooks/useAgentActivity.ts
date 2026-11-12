// Atividade do agente no canvas: registro das ações, destaque nas janelas que ele
// criou/alterou (fica até o usuário clicar na janela) e desfazer (da mais recente para trás).

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasNodeData } from "../lib/canvasNodes";

const MAX_ACTIONS = 100;

export interface AgentAction {
  id: number;
  time: number;
  /** Nome do agente (título do terminal dele). */
  agent: string;
  text: string;
  /** Como desfazer: janelas criadas (remover) e versões anteriores das alteradas. */
  undo?: { created: string[]; prev: CanvasNodeData[] };
  /** Desfazer que não é mudança de janelas (ex.: desenho num quadro). */
  revert?: () => void;
  undone: boolean;
}

/** Destaque de uma janela (n muda a cada ação, para reiniciar a animação). */
export interface AgentMark {
  agent: string;
  n: number;
}

/** Diferença entre duas listas de janelas: criadas e versões anteriores das alteradas. */
function diff(before: CanvasNodeData[], after: CanvasNodeData[]) {
  const old = new Map(before.map((n) => [n.id, n]));
  const created: string[] = [];
  const prev: CanvasNodeData[] = [];
  for (const n of after) {
    const o = old.get(n.id);
    if (!o) created.push(n.id);
    else if (o !== n) prev.push(o);
  }
  return { created, prev };
}

export function useAgentActivity(projectKey: string | null) {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [marks, setMarks] = useState<Record<string, AgentMark>>({});
  const [unseen, setUnseen] = useState(0);
  const nextId = useRef(1);

  // Trocou de projeto: começa do zero (o histórico é por projeto e por sessão).
  useEffect(() => {
    setActions([]);
    setMarks({});
    setUnseen(0);
  }, [projectKey]);

  const mark = useCallback((ids: string[], agent: string) => {
    if (!ids.length) return;
    const n = nextId.current;
    setMarks((m) => {
      const next = { ...m };
      for (const id of ids) next[id] = { agent, n };
      return next;
    });
  }, []);

  /** O usuário clicou na janela: tira o destaque dela. */
  const clearMark = useCallback((id: string) => {
    setMarks((m) => {
      if (!m[id]) return m;
      const { [id]: _drop, ...rest } = m;
      return rest;
    });
  }, []);

  /**
   * Registra uma ação. Com `before`/`after`, calcula como desfazer e destaca as janelas
   * criadas/alteradas. `touched` destaca janelas sem mudança (ex.: centralizar).
   */
  const record = useCallback(
    (
      agent: string,
      text: string,
      change?: { before: CanvasNodeData[]; after: CanvasNodeData[] },
      touched: string[] = [],
      revert?: () => void,
    ) => {
      const undo = change ? diff(change.before, change.after) : undefined;
      const action: AgentAction = {
        id: nextId.current++,
        time: Date.now(),
        agent,
        text,
        undo: undo && (undo.created.length || undo.prev.length) ? undo : undefined,
        revert,
        undone: false,
      };
      setActions((list) => [action, ...list].slice(0, MAX_ACTIONS));
      setUnseen((u) => u + 1);
      mark([...(undo ? [...undo.created, ...undo.prev.map((p) => p.id)] : []), ...touched], agent);
    },
    [mark],
  );

  /** Só a ação desfazível mais recente pode ser desfeita (pilha), para não embaralhar. */
  const latestUndoable = actions.find((a) => (a.undo || a.revert) && !a.undone) ?? null;

  /** Marca como desfeita e devolve os dados para o canvas aplicar. */
  const takeUndo = useCallback(
    (id: number) => {
      const a = actions.find((x) => x.id === id);
      if (!a || a.undone || !(a.undo || a.revert) || a !== latestUndoable) return null;
      setActions((list) => list.map((x) => (x.id === id ? { ...x, undone: true } : x)));
      return { undo: a.undo, revert: a.revert };
    },
    [actions, latestUndoable],
  );

  const markSeen = useCallback(() => setUnseen(0), []);

  return { actions, marks, unseen, markSeen, record, latestUndoable, takeUndo, clearMark };
}
