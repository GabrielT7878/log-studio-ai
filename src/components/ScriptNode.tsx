import { ChevronDown, ChevronUp, Play, ShieldAlert, Square } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  SCRIPT_COLLAPSED_H,
  SCRIPT_MAX,
  SCRIPT_MIN_OPEN_H,
  SCRIPT_MIN_W,
  type NodePatch,
  type ScriptNodeData,
} from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";
import * as terminals from "../lib/terminals";
import { TitleInput } from "./TerminalNode";

/** O que a janela pede ao Canvas. */
export type ScriptAction = "run" | "stop" | "approve" | "expand" | "collapse" | "edit";

/** Estado (status + código de saída) do Script, atualizado quando muda. */
export function useScriptState(id: string | null): terminals.ScriptState {
  const subscribe = useCallback((fn: () => void) => (id ? terminals.onScriptState(id, fn) : () => {}), [id]);
  return useSyncExternalStore(subscribe, () => (id ? terminals.scriptState(id) : IDLE));
}
const IDLE: terminals.ScriptState = { status: "idle", code: null };

export const SCRIPT_STATUS_LABEL: Record<terminals.ScriptStatus, string> = {
  idle: "Parado",
  running: "Rodando",
  ok: "Terminou sem erro",
  error: "Erro",
  stopped: "Parado",
};

/** Texto do status para o title da bolinha. */
export function scriptStatusText(s: terminals.ScriptState) {
  const base = SCRIPT_STATUS_LABEL[s.status];
  return s.code !== null && s.status !== "running" ? `${base} (código ${s.code})` : base;
}

interface Props {
  node: ScriptNodeData;
  space: string;
  projectId: string;
  zoom: number;
  selected: boolean;
  editingTitle: boolean;
  editingCommand: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: NodePatch) => void;
  onTitleDone: (id: string, title: string | null) => void;
  /** Fim da edição do comando (null = cancelou). */
  onCommandDone: (id: string, command: string | null) => void;
  onAction: (id: string, action: ScriptAction) => void;
}

export function ScriptNode({
  node,
  space,
  projectId,
  zoom,
  selected,
  editingTitle,
  editingCommand,
  onSelect,
  onChange,
  onTitleDone,
  onCommandDone,
  onAction,
}: Props) {
  const state = useScriptState(node.id);
  const running = state.status === "running";
  const pendingApproval = !node.approved && !!node.command.trim();
  const showLogs = node.expanded && !editingCommand && !pendingApproval;
  const bodyRef = useRef<HTMLDivElement>(null);

  // Logs: anexa o xterm quando a área aparece (o processo só inicia com "run").
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!showLogs || !body) return;
    terminals.attach(node.id, body, { space, project: projectId, agent: "script", command: node.command }, zoom, false);
    return () => terminals.detach(node.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando a área dos logs aparece/some
  }, [node.id, showLogs]);

  useLayoutEffect(() => {
    if (showLogs) terminals.setZoom(node.id, zoom);
  }, [node.id, zoom, showLogs]);

  const startMove = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, textarea")) return;
    onSelect(node.id);
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { w, h } = node;
    dragPointer(
      e,
      (dx, dy) =>
        onChange(node.id, {
          w: Math.max(SCRIPT_MIN_W, w + dx / zoom),
          // Recolhido: só a largura muda.
          ...(node.expanded ? { h: Math.max(SCRIPT_MIN_OPEN_H, h + dy / zoom) } : {}),
        }),
      () => terminals.fit(node.id),
    );
  };

  const mainButton = pendingApproval ? (
    <button
      className="sc-btn sc-approve-btn"
      title="Comando definido por um agente: revisar e aprovar"
      onClick={() => onAction(node.id, "expand")}
    >
      <ShieldAlert size={14} />
    </button>
  ) : running ? (
    <button className="sc-btn sc-stop" title="Parar" onClick={() => onAction(node.id, "stop")}>
      <Square size={12} fill="currentColor" />
    </button>
  ) : (
    <button
      className="sc-btn sc-run"
      title={node.command.trim() ? "Executar" : "Configurar comando"}
      onClick={() => onAction(node.id, "run")}
    >
      <Play size={13} fill="currentColor" />
    </button>
  );

  return (
    <div
      className={`canvas-node sc-node sc-${state.status}${selected ? " selected" : ""}${node.expanded ? " expanded" : ""}${
        pendingApproval ? " pending" : ""
      }`}
      data-node-id={node.id}
      style={
        {
          "--nx": node.x,
          "--ny": node.y,
          "--nw": node.w,
          "--nh": node.expanded ? node.h : SCRIPT_COLLAPSED_H,
          zIndex: selected ? 2 : 1,
        } as React.CSSProperties
      }
      onPointerDown={() => onSelect(node.id)}
    >
      <div className="sc-bar" onPointerDown={editingTitle ? undefined : startMove}>
        <span className="sc-dot" title={scriptStatusText(state)} aria-label={scriptStatusText(state)} />
        <div className="sc-text">
          {editingTitle ? (
            <TitleInput value={node.title} onDone={(t) => onTitleDone(node.id, t)} />
          ) : (
            <span className="sc-title">{node.title}</span>
          )}
          <span className="sc-cmd" title={node.command}>
            {node.command.trim() ? node.command.split("\n")[0] : "sem comando"}
          </span>
        </div>
        {mainButton}
        <button
          className="sc-btn"
          title={node.expanded ? "Recolher" : "Expandir (logs)"}
          onClick={() => onAction(node.id, node.expanded ? "collapse" : "expand")}
        >
          {node.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {node.expanded && editingCommand && (
        <CommandEditor value={node.command} onDone={(c) => onCommandDone(node.id, c)} />
      )}

      {node.expanded && !editingCommand && pendingApproval && (
        <div className="sc-approval" onPointerDown={(e) => e.stopPropagation()}>
          <span className="sc-approval-title">
            <ShieldAlert size={13} /> Um agente definiu este comando. Revise antes de executar:
          </span>
          <pre className="sc-approval-cmd">{node.command}</pre>
          <div className="sc-approval-actions">
            <button className="sc-approval-ok" onClick={() => onAction(node.id, "approve")}>
              Aprovar e executar
            </button>
            <button className="sc-approval-edit" onClick={() => onAction(node.id, "edit")}>
              Editar
            </button>
          </div>
        </div>
      )}

      {showLogs && <div className="term-body sc-body" ref={bodyRef} onPointerDown={() => terminals.focus(node.id)} />}

      <div className="node-resize" title="Redimensionar" onPointerDown={startResize} />
    </div>
  );
}

/** Campo do comando. Ctrl+Enter salva, Esc cancela. */
function CommandEditor({ value, onDone }: { value: string; onDone: (command: string | null) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <div className="sc-editor" onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className="sc-editor-input"
        defaultValue={value}
        autoFocus
        spellCheck={false}
        maxLength={SCRIPT_MAX}
        placeholder="Comando do PowerShell, ex.: npm run dev"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            finish(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        }}
      />
      <div className="sc-editor-actions">
        <span className="sc-editor-hint">Roda na pasta do projeto · Ctrl+Enter salva · Esc cancela</span>
        <button className="sc-editor-cancel" onClick={() => finish(null)}>
          Cancelar
        </button>
        <button className="sc-editor-save" onClick={() => finish(ref.current?.value ?? value)}>
          Salvar
        </button>
      </div>
    </div>
  );
}
