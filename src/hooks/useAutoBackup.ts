import { useEffect } from "react";
import { api } from "../lib/api";
import { flushCanvas } from "./useCanvasNodes";

/** De quanto em quanto tempo verifica se precisa de backup. */
const CHECK_MS = 10 * 60 * 1000;
/** Idade máxima do último backup (segundos) antes de fazer outro. */
const MAX_AGE_S = 60 * 60;

/**
 * Backup automático (se ligado nas Configurações): ao abrir o app e a cada 10 min,
 * faz um backup se o último tiver mais de 1 hora — ou na hora, se o último foi
 * interrompido (queda de energia, app encerrado à força).
 */
export function useAutoBackup(notify: (msg: string) => void) {
  useEffect(() => {
    let stopped = false;

    const check = async () => {
      try {
        const st = await api.backupStatus();
        if (stopped || !st.auto || st.running) return;
        const old = st.lastBackupAt === null || Date.now() / 1000 - st.lastBackupAt > MAX_AGE_S;
        if (!st.needsRecovery && !old) return;
        await flushCanvas();
        const info = await api.backupCreate();
        if (stopped) return;
        const skipped = info.skipped.length ? ` ${info.skipped.length} arquivo(s) em uso ficaram de fora.` : "";
        notify(
          st.needsRecovery
            ? `O último backup foi interrompido; um novo backup foi feito.${skipped}`
            : `Backup automático concluído.${skipped}`,
        );
      } catch (e) {
        // Outro backup (manual ou ao fechar) já está rodando: tudo bem.
        if (!stopped && !String(e).includes("em andamento")) notify(`Backup automático falhou: ${e}`);
      }
    };

    check();
    const id = window.setInterval(check, CHECK_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [notify]);
}
