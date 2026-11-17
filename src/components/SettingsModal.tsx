import {
  Bot,
  ChevronDown,
  HardDrive,
  Info,
  Keyboard,
  KeyRound,
  RefreshCw,
  SlidersHorizontal,
  SquareTerminal,
  Waypoints,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { api, type BackupInfo, type BackupProgress, type BackupStatus, type ReleaseInfo } from "../lib/api";
import { flushCanvas } from "../hooks/useCanvasNodes";
import type { useUpdater } from "../hooks/useUpdater";
import { renderMarkdown } from "../lib/markdown";

type TabId = "geral" | "atualizacoes";

/** Abas do topo; só as que têm `id` já funcionam (as outras ainda são visuais). */
const tabs: { icon: typeof Info; label: string; id?: TabId }[] = [
  { icon: SlidersHorizontal, label: "Geral", id: "geral" },
  { icon: SquareTerminal, label: "Terminal" },
  { icon: Bot, label: "Agentes" },
  { icon: Keyboard, label: "Atalhos" },
  { icon: Waypoints, label: "Wire" },
  { icon: KeyRound, label: "Licença" },
  { icon: RefreshCw, label: "Atualizações", id: "atualizacoes" },
  { icon: HardDrive, label: "Dados" },
  { icon: Info, label: "Sobre" },
];

type Updater = ReturnType<typeof useUpdater>;

const subTabs = ["Sistema", "Tela", "Notificações", "Ambientes", "Git"];

function Select({ value }: { value: string }) {
  return (
    <button className="st-select">
      <span>{value}</span>
      <ChevronDown size={14} />
    </button>
  );
}

function Toggle({ on = false, label, onChange }: { on?: boolean; label?: string; onChange?: (on: boolean) => void }) {
  return (
    <button
      className={`st-toggle${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange && (() => onChange(!on))}
    />
  );
}

function Row({
  title,
  desc,
  info,
  control,
}: {
  title: string;
  desc?: string;
  info?: boolean;
  control: ReactNode;
}) {
  return (
    <div className="st-row">
      <div className="st-row-text">
        <div className="st-row-title">
          {title}
          {info && <Info size={13} className="st-info" />}
        </div>
        {desc && <div className="st-row-desc">{desc}</div>}
      </div>
      <div className="st-row-control">{control}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="st-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** Diretório onde novas pastas e projetos são criados (salvo no backend). */
function ProjectsRootSection({ onChanged }: { onChanged: () => void }) {
  const [root, setRoot] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setRoot(s.projectsRoot))
      .catch((e) => setError(String(e)));
  }, []);

  const change = async () => {
    setError(null);
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: root || undefined,
        title: "Escolha o diretório dos projetos",
      });
      if (typeof picked !== "string") return; // cancelado
      const s = await api.setProjectsRoot(picked);
      setRoot(s.projectsRoot);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Section title="PROJETOS">
      <Row
        title="Diretório padrão"
        desc="Onde novas pastas e projetos são criados. Ao trocar, o conteúdo do diretório anterior não é movido."
        control={
          <div className="st-path">
            <span className="st-path-text" title={root}>
              {root || "…"}
            </span>
            <button className="st-btn" onClick={change}>
              Alterar…
            </button>
          </div>
        }
      />
      {error && <div className="st-error">{error}</div>}
    </Section>
  );
}

const fmtDate = (secs: number) =>
  new Date(secs * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} ${units[i]}`;
}

/** Backup da estrutura dos projetos e dos canvas: destino, automático, backup manual e restauração. */
function BackupSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restoredTo, setRestoredTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [st, list] = await Promise.all([api.backupStatus(), api.backupList()]);
    setStatus(st);
    setBackups(list);
    setRunning(st.running);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    const unlisten = api.onBackupProgress(setProgress);
    return () => {
      unlisten.then((f) => f());
    };
  }, [refresh]);

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    }
  };

  const changeDir = () =>
    guard(async () => {
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: status?.dir || undefined,
        title: "Escolha a pasta dos backups",
      });
      if (typeof picked !== "string") return; // cancelado
      setStatus(await api.setBackupSettings({ dir: picked }));
      setBackups(await api.backupList());
    });

  const setAuto = (auto: boolean) => guard(async () => setStatus(await api.setBackupSettings({ auto })));

  const backupNow = () =>
    guard(async () => {
      setMessage(null);
      setRestoredTo(null);
      setProgress(null);
      setRunning(true);
      try {
        await flushCanvas(); // salva o canvas aberto antes de copiar os arquivos
        const info = await api.backupCreate();
        const skipped = info.skipped.length ? ` ${info.skipped.length} arquivo(s) em uso ficaram de fora.` : "";
        setMessage(`Backup concluído: ${info.files} arquivo(s), ${fmtSize(info.size)}.${skipped}`);
      } finally {
        setRunning(false);
        setProgress(null);
        await refresh();
      }
    });

  const restore = (file: string) =>
    guard(async () => {
      setConfirming(null);
      setMessage(null);
      setRestoredTo(await api.backupRestore(file));
    });

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Section title="BACKUP">
      <Row
        title="Pasta dos backups"
        desc="Cada backup é um .zip com os espaços, as pastas dos projetos e os canvas (notas, imagens, anexos e quadros). Os demais arquivos dos projetos não entram."
        control={
          <div className="st-path">
            <span className="st-path-text" title={status?.dir}>
              {status?.dir || "…"}
            </span>
            <button className="st-btn" onClick={changeDir}>
              Alterar…
            </button>
          </div>
        }
      />
      <Row
        title="Backup automático"
        desc="Faz um backup quando o último tiver mais de 1 hora e ao fechar o app."
        control={<Toggle on={status?.auto ?? false} label="Backup automático" onChange={setAuto} />}
      />
      <Row
        title="Fazer backup agora"
        desc={status?.lastBackupAt ? `Último backup: ${fmtDate(status.lastBackupAt)}` : "Nenhum backup feito ainda."}
        control={
          <button className="st-btn" onClick={backupNow} disabled={running}>
            {running ? "Fazendo backup…" : "Fazer backup agora"}
          </button>
        }
      />
      {running && (
        <div className="st-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="st-progress-bar" style={{ width: `${pct}%` }} />
          <span>{progress ? `${progress.done} de ${progress.total} arquivos` : "Preparando…"}</span>
        </div>
      )}
      {message && <div className="st-ok">{message}</div>}
      {restoredTo && (
        <div className="st-ok st-restored" title={restoredTo}>
          Restaurado em: {restoredTo}
        </div>
      )}
      {error && <div className="st-error">{error}</div>}

      {backups.length > 0 && (
        <ul className="st-backups" aria-label="Backups">
          {backups.map((b) => (
            <li key={b.file} className="st-backup">
              <div className="st-backup-text">
                <span className="st-backup-date">{fmtDate(b.createdAt)}</span>
                <span className="st-backup-meta">
                  {fmtSize(b.size)} · {b.files} arquivo(s) · {b.spaces.length} espaço(s)
                  {b.skipped.length > 0 && ` · ${b.skipped.length} em uso, fora do backup`}
                </span>
              </div>
              {confirming === b.file ? (
                <div className="st-backup-confirm">
                  <span>Restaurar numa pasta nova?</span>
                  <button className="st-btn" onClick={() => restore(b.file)}>
                    Restaurar
                  </button>
                  <button className="st-btn st-btn-ghost" onClick={() => setConfirming(null)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <button className="st-btn" onClick={() => setConfirming(b.file)}>
                  Restaurar…
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function fmtReleaseDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/** Links do changelog não navegam dentro do app (a janela é o próprio app). */
function blockLinks(e: MouseEvent) {
  if ((e.target as HTMLElement).closest("a")) e.preventDefault();
}

function ReleaseBody({ body }: { body: string }) {
  const html = useMemo(() => (body.trim() ? renderMarkdown(body) : ""), [body]);
  if (!html) return <div className="st-release-empty">Sem descrição.</div>;
  return <div className="st-release-body" onClick={blockLinks} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Texto do status e botão da linha "versão" da aba Atualizações. */
function updateStatus(updater: Updater, onRestart: () => void): { status: string; control: ReactNode } {
  const { state, lastCheck, enabled } = updater;
  if (!enabled) return { status: "A atualização automática só funciona na versão instalada.", control: null };
  switch (state.phase) {
    case "available":
      return {
        status: `Versão ${state.version} disponível.`,
        control: (
          <button className="st-btn" onClick={updater.download}>
            Baixar
          </button>
        ),
      };
    case "downloading": {
      const pct = state.progress !== null ? ` — ${Math.round(state.progress * 100)}%` : "…";
      return { status: `Baixando versão ${state.version}${pct}`, control: null };
    }
    case "ready":
      return {
        status: `Versão ${state.version} pronta. Reiniciar fecha os terminais abertos.`,
        control: (
          <button className="st-btn" onClick={onRestart}>
            Reiniciar para atualizar
          </button>
        ),
      };
    case "installing":
      return { status: `Instalando versão ${state.version}…`, control: null };
    case "error":
      return {
        status: `Falha ao atualizar: ${state.message}`,
        control: (
          <button className="st-btn" onClick={updater.download}>
            Tentar de novo
          </button>
        ),
      };
  }
  const status =
    lastCheck.status === "checking"
      ? "Verificando…"
      : lastCheck.status === "failed"
        ? `Não foi possível verificar: ${lastCheck.message}`
        : lastCheck.status === "latest"
          ? "Você está na versão mais recente."
          : "Ainda não verificado.";
  return {
    status,
    control: (
      <button className="st-btn" onClick={() => void updater.checkNow()} disabled={lastCheck.status === "checking"}>
        Verificar agora
      </button>
    ),
  };
}

/** Aba Atualizações: versão instalada, verificar/baixar/reiniciar e changelog do GitHub. */
function UpdatesTab({ updater, onRestart }: { updater: Updater; onRestart: () => void }) {
  const [version, setVersion] = useState("");
  const [releases, setReleases] = useState<ReleaseInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
    api
      .releasesList()
      .then(setReleases)
      .catch((e) => setError(String(e)));
  }, []);

  const { status, control } = updateStatus(updater, onRestart);
  const newer = releases?.filter((r) => r.newer) ?? [];
  const older = releases?.filter((r) => !r.newer) ?? [];
  const renderRelease = (r: ReleaseInfo) => (
    <li key={r.version} className={`st-release${r.newer ? " newer" : ""}`}>
      <div className="st-release-head">
        <span className="st-release-version">v{r.version}</span>
        {r.newer && <span className="st-badge new">Nova</span>}
        {r.version === version && <span className="st-badge">Instalada</span>}
        <span className="st-release-date">{fmtReleaseDate(r.publishedAt)}</span>
      </div>
      <ReleaseBody body={r.body} />
    </li>
  );

  return (
    <>
      <Section title="VERSÃO">
        <Row title={`Log Studio AI ${version || "…"}`} desc={status} control={control} />
      </Section>
      <Section title="NOVIDADES">
        {error && <div className="st-error">{error}</div>}
        {!releases && !error && <div className="st-release-empty">Carregando as versões…</div>}
        {releases && releases.length === 0 && <div className="st-release-empty">Nenhuma versão publicada.</div>}
        {newer.length > 0 && (
          <ul className="st-releases" aria-label="Novas versões">
            {newer.map(renderRelease)}
          </ul>
        )}
        {older.length > 0 && (
          <>
            {newer.length > 0 && <h4 className="st-releases-sub">Versões anteriores</h4>}
            <ul className="st-releases" aria-label="Versões anteriores">
              {older.map(renderRelease)}
            </ul>
          </>
        )}
      </Section>
    </>
  );
}

export function SettingsModal({
  onClose,
  closing,
  onProjectsRootChanged,
  updater,
  onRestartForUpdate,
}: {
  onClose: () => void;
  closing: boolean;
  onProjectsRootChanged: () => void;
  updater: Updater;
  onRestartForUpdate: () => void;
}) {
  const [tab, setTab] = useState<TabId>("geral");
  return (
    <div className={`st-overlay${closing ? " closing" : ""}`}>
      <div className="st-modal">
        <header className="st-tabs" role="tablist">
          {tabs.map(({ icon: Icon, label, id }) => {
            const active = id !== undefined && id === tab;
            return (
              <button
                key={label}
                role="tab"
                aria-selected={active}
                className={`st-tab${active ? " active" : ""}`}
                onClick={id && (() => setTab(id))}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            );
          })}
          <button className="st-close" onClick={onClose} title="Fechar">
            <X size={16} />
          </button>
        </header>

        {tab === "atualizacoes" ? (
          <div className="st-content">
            <UpdatesTab updater={updater} onRestart={onRestartForUpdate} />
          </div>
        ) : (
          <GeneralTab onProjectsRootChanged={onProjectsRootChanged} />
        )}
      </div>
    </div>
  );
}

/** Aba Geral (backup, pasta de projetos e opções ainda visuais). */
function GeneralTab({ onProjectsRootChanged }: { onProjectsRootChanged: () => void }) {
  return (
    <div className="st-content">
      <div className="st-segmented">
        {subTabs.map((t, i) => (
          <button key={t} className={i === 0 ? "active" : ""}>
            {t}
          </button>
        ))}
      </div>

      <ProjectsRootSection onChanged={onProjectsRootChanged} />

      <BackupSection />

      <Section title="IDIOMA">
        <Row title="Idioma" control={<Select value="Padrão do Sistema" />} />
      </Section>

      <Section title="APARÊNCIA">
        <Row
          title="Aparência"
          desc="Escolha a aparência do Log Studio AI. Sistema segue a configuração do seu sistema operacional."
          control={<Select value="Escuro" />}
        />
        <Row
          title="Cursor de mão ao passar o mouse"
          desc="Mostra o cursor de mão sobre botões e menus, como em um navegador web. Desativado, o Log Studio AI usa a seta como os apps nativos."
          control={<Toggle />}
        />
      </Section>

      <Section title="ENERGIA">
        <Row
          title="Impedir a suspensão"
          desc="Impede a suspensão automática para que os agentes continuem trabalhando sem supervisão. No Windows, isso também mantém a tela ligada enquanto a opção estiver valendo."
          control={<Select value="Enquanto os agentes trabalham" />}
        />
      </Section>

      <Section title="ENCERRAMENTO DO APP">
        <Row
          title="Solicitar confirmação ao encerrar"
          desc="Pergunta antes de sair, para que fechar a janela por engano não interrompa os agentes em execução."
          control={<Toggle />}
        />
        <Row title="Tentar restaurar as sessões dos agentes" info control={<Toggle on />} />
        <Row
          title="Fechar para a bandeja"
          desc="Fechar a janela mantém o Log Studio AI em execução na bandeja do sistema. Quando desativado, fechar encerra o app."
          control={<Toggle />}
        />
      </Section>
    </div>
  );
}
