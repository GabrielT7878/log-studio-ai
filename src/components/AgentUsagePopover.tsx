import { RefreshCw } from "lucide-react";
import type { UsageAgent, UsageEntry } from "../hooks/useAgentUsage";
import type { AgentLimit } from "../lib/api";
import { RingGauge } from "./RingGauge";

const SEGMENTS = 40;

/** Aparência de cada agente (anel, trilho e barras). */
const AGENT_STYLE: Record<UsageAgent, { name: string; color: string; track: string; session: string; weekly: string }> = {
  claude: { name: "Claude Code", color: "#e07a55", track: "#4a3430", session: "#e48a68", weekly: "#f2a882" },
  codex: { name: "Codex", color: "#3fa37a", track: "#244a3b", session: "#4fb98b", weekly: "#7fd1aa" },
};

interface LimitView {
  key: string;
  label: string;
  percent: number;
  reset: string;
  color: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Redefine em 3 horas", "Redefine amanhã às 21:00", "Redefine depois de amanhã"… */
export function resetText(iso: string | null, now = new Date()) {
  if (!iso) return "";
  const at = new Date(iso);
  const ms = at.getTime() - now.getTime();
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "Redefinido";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `Redefine em ${Math.max(1, min)} min`;
  const hours = Math.round(min / 60);
  if (hours < 24 && at.getDate() === now.getDate()) return `Redefine em ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  if (days <= 1) return `Redefine amanhã às ${hhmm(at)}`;
  if (days === 2) return "Redefine depois de amanhã";
  return `Redefine em ${pad(at.getDate())}/${pad(at.getMonth() + 1)} às ${hhmm(at)}`;
}

/** Limites → grupos: "Limites do plano" (sessão + semanal) e um grupo por modelo. */
function toGroups(limits: AgentLimit[], agent: UsageAgent) {
  const style = AGENT_STYLE[agent];
  const groups = new Map<string, LimitView[]>();
  limits.forEach((l, i) => {
    const title = l.model ?? "Limites do plano";
    const label = l.kind === "session" ? "Sessão" : l.group === "weekly" ? "Semanal" : l.kind;
    const view: LimitView = {
      key: `${l.kind}-${i}`,
      label,
      percent: Math.round(l.percent),
      reset: resetText(l.resetsAt),
      color: l.group === "session" ? style.session : style.weekly,
    };
    groups.set(title, [...(groups.get(title) ?? []), view]);
  });
  return [...groups].map(([title, items]) => ({ title, items }));
}

function SegmentBar({ percent, color }: { percent: number; color: string }) {
  const filled = Math.round((Math.min(100, percent) / 100) * SEGMENTS);
  return (
    <div className="au-bar">
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span key={i} style={i < filled ? { background: color } : undefined} />
      ))}
    </div>
  );
}

function subtitle(entry: UsageEntry) {
  const r = entry.report;
  if (!r) return entry.loading ? "Atualizando…" : "—";
  if (r.status === "notInstalled") return "Não instalado";
  if (r.status === "error") return "Não foi possível ler o uso";
  const plan = r.plan ? r.plan.charAt(0).toUpperCase() + r.plan.slice(1) : "Plano";
  if (!r.available) return `${plan} · sem limites de plano`;
  const when = entry.updatedAt ? ` · atualizado às ${hhmm(new Date(entry.updatedAt))}` : "";
  return `${plan}${when}`;
}

function AgentCard({ agent, entry }: { agent: UsageAgent; entry: UsageEntry }) {
  const style = AGENT_STYLE[agent];
  const r = entry.report;
  const groups = r?.status === "ok" && r.available ? toGroups(r.limits, agent) : [];
  const percents = groups.flatMap((g) => g.items.map((l) => l.percent));
  const multi = percents.length > 0;

  return (
    <div className="au-agent">
      <div className="au-agent-head">
        <RingGauge
          size={90}
          rings={multi ? percents : [0]}
          color={style.color}
          track={style.track}
          strokeWidth={multi ? 8 : 11}
          gap={4}
        />
        <div>
          <div className="au-agent-name">{style.name}</div>
          <div className="au-agent-sub">{subtitle(entry)}</div>
        </div>
      </div>

      {r?.status === "error" && <div className="au-limit-reset au-error">{r.message}</div>}

      {groups.map((g) => (
        <div key={g.title} className="au-group">
          <div className="au-group-title">{g.title}</div>
          {g.items.map((l) => (
            <div key={l.key} className="au-limit">
              <div className="au-limit-row">
                <span>{l.label}</span>
                <span>{l.percent}%</span>
              </div>
              <SegmentBar percent={l.percent} color={l.color} />
              <div className="au-limit-reset">{l.reset}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AgentUsagePopover({
  closing,
  usage,
  onRefresh,
}: {
  closing: boolean;
  usage: Record<UsageAgent, UsageEntry>;
  onRefresh: () => void;
}) {
  const loading = usage.claude.loading || usage.codex.loading;
  return (
    <div className={`au-popover${closing ? " closing" : ""}`}>
      <header className="au-header">
        <h2>Uso dos Agentes</h2>
        <button className={`icon-btn small${loading ? " spinning" : ""}`} title="Atualizar" onClick={onRefresh}>
          <RefreshCw size={13} />
        </button>
      </header>
      <div className="au-content">
        <AgentCard agent="claude" entry={usage.claude} />
        <AgentCard agent="codex" entry={usage.codex} />
      </div>
      <footer className="au-footer">
        <button className="au-link">Configurações…</button>
      </footer>
    </div>
  );
}

/** Texto ao lado do anel do botão: uso da sessão (5h) e semanal (7d); "–" sem dados. */
export function pillText(entry: UsageEntry) {
  const r = entry.report;
  const find = (kind: string) => {
    const l = r?.status === "ok" && r.available ? r.limits.find((x) => x.kind === kind) : undefined;
    return l ? `${Math.round(l.percent)}%` : "–";
  };
  return { five: find("session"), week: find("weekly_all") };
}

/** Percentuais para o mini anel do botão (até 3 anéis; sem dados = vazios). */
export function pillRings(entry: UsageEntry) {
  const r = entry.report;
  const p = r?.status === "ok" && r.available ? r.limits.map((l) => Math.round(l.percent)) : [];
  return [0, 1, 2].map((i) => p[i] ?? 0);
}
