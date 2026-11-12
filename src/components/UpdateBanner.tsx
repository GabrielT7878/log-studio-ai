import { Download, RotateCw, X } from "lucide-react";
import type { UpdaterState } from "../hooks/useUpdater";

interface Props {
  state: UpdaterState;
  onDownload: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

/** Aviso discreto (canto inferior direito) de atualização disponível/baixando/pronta. */
export function UpdateBanner({ state, onDownload, onRestart, onDismiss }: Props) {
  if (state.phase === "idle") return null;
  const v = state.version;
  const pct = state.phase === "downloading" && state.progress !== null ? Math.round(state.progress * 100) : null;

  return (
    <div className="update-banner" role="status">
      <div className="update-text">
        {state.phase === "available" && <>Versão {v} disponível</>}
        {state.phase === "downloading" && <>Baixando versão {v}{pct !== null ? ` — ${pct}%` : "…"}</>}
        {state.phase === "ready" && (
          <>
            Versão {v} pronta
            <span className="update-sub">Reiniciar fecha os terminais abertos.</span>
          </>
        )}
        {state.phase === "installing" && <>Instalando versão {v}…</>}
        {state.phase === "error" && (
          <>
            Falha ao atualizar
            <span className="update-sub" title={state.message}>{state.message}</span>
          </>
        )}
        {state.phase === "downloading" && (
          <div className="update-bar">
            <div className="update-bar-fill" style={{ width: pct !== null ? `${pct}%` : "30%" }} />
          </div>
        )}
      </div>
      {(state.phase === "available" || state.phase === "error") && (
        <button className="update-btn" onClick={onDownload}>
          <Download size={14} /> {state.phase === "error" ? "Tentar de novo" : "Baixar"}
        </button>
      )}
      {state.phase === "ready" && (
        <button className="update-btn" onClick={onRestart}>
          <RotateCw size={14} /> Reiniciar para atualizar
        </button>
      )}
      {state.phase !== "downloading" && state.phase !== "installing" && (
        <button className="update-close" onClick={onDismiss} aria-label="Fechar aviso">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
