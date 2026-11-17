import { useEffect, useRef, useState } from "react";
import { api, type BackupProgress } from "../lib/api";
import { flushCanvas } from "../hooks/useCanvasNodes";

const POLL_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Backup ao fechar: com o automático ligado, o backend segura o X da janela e emite
 * `app://close-requested`. Se algo mudou desde o último backup (ou o último foi
 * interrompido), faz um backup mostrando o progresso e só então fecha o app.
 */
export function BackupCloseOverlay() {
  const [phase, setPhase] = useState<"idle" | "running" | "error">("idle");
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState("");
  const busy = useRef(false);

  useEffect(() => {
    const start = async () => {
      if (busy.current) return; // já está fechando (clicou no X de novo)
      busy.current = true;
      try {
        await flushCanvas();
        const st = await api.backupStatus();
        if (st.running) {
          // Um backup (automático ou manual) já está rodando: espera ele terminar.
          setPhase("running");
          while ((await api.backupStatus()).running) await sleep(POLL_MS);
        } else if (st.needsRecovery || (await api.backupHasChanges())) {
          setProgress(null);
          setPhase("running");
          await api.backupCreate();
        }
        await api.appExit();
      } catch (e) {
        setError(String(e));
        setPhase("error");
        busy.current = false;
      }
    };

    const unlistenClose = api.onCloseRequested(() => {
      api.closeAck();
      start();
    });
    const unlistenProgress = api.onBackupProgress(setProgress);
    return () => {
      unlistenClose.then((f) => f());
      unlistenProgress.then((f) => f());
    };
  }, []);

  if (phase === "idle") return null;

  // O backup interrompido fica marcado e é refeito na próxima abertura.
  const cancelAndExit = async () => {
    await api.backupCancel();
    await api.appExit();
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="backup-close" role="dialog" aria-label="Backup ao fechar">
      <div className="backup-close-card">
        {phase === "running" ? (
          <>
            <h2>Fazendo backup…</h2>
            <p>O Log Studio AI fecha assim que o backup terminar.</p>
            <div className="st-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="st-progress-bar" style={{ width: `${pct}%` }} />
              <span>{progress ? `${progress.done} de ${progress.total} arquivos` : "Preparando…"}</span>
            </div>
            <div className="backup-close-actions">
              <button className="st-btn st-btn-ghost" onClick={cancelAndExit}>
                Cancelar e fechar
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>O backup falhou</h2>
            <p className="st-error">{error}</p>
            <div className="backup-close-actions">
              <button className="st-btn st-btn-ghost" onClick={() => setPhase("idle")}>
                Voltar
              </button>
              <button className="st-btn" onClick={() => api.appExit()}>
                Fechar mesmo assim
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
