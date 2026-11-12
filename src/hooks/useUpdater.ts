// Atualização automática pelos releases do GitHub (só na versão instalada).
// Fluxo: verifica ao abrir e a cada CHECK_EVERY_MS → "Versão X disponível" → Baixar (progresso)
// → "Reiniciar para atualizar" (instala e reabre o app).
import { useCallback, useEffect, useRef, useState } from "react";
import { getIdentifier } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** Identifier da versão publicada (src-tauri/tauri.conf.json). */
const RELEASE_IDENTIFIER = "com.logstudio.ai";

export type UpdaterState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; progress: number | null }
  | { phase: "ready"; version: string }
  | { phase: "installing"; version: string }
  | { phase: "error"; version: string; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const update = useRef<Update | null>(null);
  const busy = useRef(false);

  const checkNow = useCallback(async () => {
    if (busy.current || update.current) return;
    try {
      const found = await check();
      if (found) {
        update.current = found;
        setDismissed(false);
        setState({ phase: "available", version: found.version });
      }
    } catch (e) {
      console.warn("[updater] falha ao verificar atualizações:", e);
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    (async () => {
      // Só a versão instalada se atualiza (dev e build de testes e2e têm outro identifier).
      if (import.meta.env.DEV) return;
      const id = await getIdentifier().catch(() => "");
      if (cancelled || id !== RELEASE_IDENTIFIER) return;
      void checkNow();
      timer = window.setInterval(() => void checkNow(), CHECK_EVERY_MS);
    })();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [checkNow]);

  const download = useCallback(async () => {
    const u = update.current;
    if (!u || busy.current) return;
    busy.current = true;
    let total = 0;
    let done = 0;
    setState({ phase: "downloading", version: u.version, progress: null });
    try {
      await u.download((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          setState({ phase: "downloading", version: u.version, progress: total ? done / total : null });
        }
      });
      setState({ phase: "ready", version: u.version });
    } catch (e) {
      setState({ phase: "error", version: u.version, message: String(e) });
    } finally {
      busy.current = false;
    }
  }, []);

  /** `beforeInstall`: dá tempo do app salvar o que estiver pendente (o instalador fecha o app). */
  const installAndRestart = useCallback(async (beforeInstall?: () => Promise<void>) => {
    const u = update.current;
    if (!u || busy.current) return;
    busy.current = true;
    setState({ phase: "installing", version: u.version });
    try {
      await beforeInstall?.();
      await u.install();
      await relaunch();
    } catch (e) {
      busy.current = false;
      setState({ phase: "error", version: u.version, message: String(e) });
    }
  }, []);

  return { state, dismissed, dismiss: () => setDismissed(true), download, installAndRestart };
}
