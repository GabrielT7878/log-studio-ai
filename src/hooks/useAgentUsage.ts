import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AgentUsageReport } from "../lib/api";

export type UsageAgent = "claude" | "codex";

export interface UsageEntry {
  /** Última leitura (mantida enquanto atualiza). */
  report: AgentUsageReport | null;
  loading: boolean;
  /** ms desde 1970 da última leitura. */
  updatedAt: number | null;
}

const AGENTS: UsageAgent[] = ["claude", "codex"];
/** Atualiza sozinho a cada 1 min. */
const REFRESH_MS = 60 * 1000;
/** Ao abrir o popover, atualiza se a leitura tiver mais que isso. */
const STALE_MS = 60 * 1000;

const EMPTY: UsageEntry = { report: null, loading: false, updatedAt: null };

/**
 * Uso do plano dos agentes (Claude Code, Codex): lê ao abrir o app, a cada 5 min
 * e quando pedido. Uma leitura por agente de cada vez.
 */
export function useAgentUsage() {
  const [usage, setUsage] = useState<Record<UsageAgent, UsageEntry>>({ claude: EMPTY, codex: EMPTY });
  const inFlight = useRef(new Set<UsageAgent>());
  const updatedAt = useRef<Record<UsageAgent, number | null>>({ claude: null, codex: null });
  /** Já houve leitura bem-sucedida? (falha depois disso mantém o último valor bom) */
  const hadOk = useRef<Record<UsageAgent, boolean>>({ claude: false, codex: false });

  const load = useCallback((agent: UsageAgent) => {
    if (inFlight.current.has(agent)) return;
    inFlight.current.add(agent);
    setUsage((u) => ({ ...u, [agent]: { ...u[agent], loading: true } }));
    api
      .agentUsage(agent)
      .catch((e): AgentUsageReport => ({ status: "error", message: String(e) }))
      .then((report) => {
        inFlight.current.delete(agent);
        // Falha passageira depois de uma leitura boa: mantém o último valor (e o horário dele).
        if (report.status === "error" && hadOk.current[agent]) {
          console.warn(`Uso do ${agent}: leitura falhou, mantendo o último valor.`, report.message);
          setUsage((u) => ({ ...u, [agent]: { ...u[agent], loading: false } }));
          return;
        }
        hadOk.current[agent] = report.status === "ok";
        const now = Date.now();
        updatedAt.current[agent] = now;
        setUsage((u) => ({ ...u, [agent]: { report, loading: false, updatedAt: now } }));
      });
  }, []);

  /** Atualiza todos agora (botão ↻). */
  const refresh = useCallback(() => AGENTS.forEach(load), [load]);

  /** Atualiza os que estiverem desatualizados (ao abrir o popover). */
  const refreshIfStale = useCallback(() => {
    const now = Date.now();
    AGENTS.forEach((a) => {
      const t = updatedAt.current[a];
      if (t === null || now - t > STALE_MS) load(a);
    });
  }, [load]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { usage, refresh, refreshIfStale };
}
