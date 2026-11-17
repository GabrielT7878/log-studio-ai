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
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type BackupInfo, type BackupProgress, type BackupStatus } from "../lib/api";
import { flushCanvas } from "../hooks/useCanvasNodes";

const tabs = [
  { icon: SlidersHorizontal, label: "Geral", active: true },
  { icon: SquareTerminal, label: "Terminal" },
  { icon: Bot, label: "Agentes" },
  { icon: Keyboard, label: "Atalhos" },
  { icon: Waypoints, label: "Wire" },
  { icon: KeyRound, label: "Licença" },
  { icon: RefreshCw, label: "Atualizações" },
  { icon: HardDrive, label: "Dados" },
  { icon: Info, label: "Sobre" },
];

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

/** Backup da raiz inteira: destino, automático, exclusões, backup manual e restauração. */
function BackupSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [exclusions, setExclusions] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restoredTo, setRestoredTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [st, list] = await Promise.all([api.backupStatus(), api.backupList()]);
    setStatus(st);
    setBackups(list);
    setRunning(st.running);
    setExclusions(st.exclusions.join(", "));
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

  const saveExclusions = () =>
    guard(async () => {
      const list = exclusions
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      if (status && list.join(",") === status.exclusions.join(",")) return;
      const st = await api.setBackupSettings({ exclusions: list });
      setStatus(st);
      setExclusions(st.exclusions.join(", "));
    });

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
        desc="Cada backup é um .zip com todos os espaços e projetos."
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
        title="Excluir do backup"
        desc="Nomes de pastas ou arquivos, separados por vírgula. Use *.ext para terminações."
        control={
          <input
            className="st-input"
            aria-label="Excluir do backup"
            value={exclusions}
            onChange={(e) => setExclusions(e.target.value)}
            onBlur={saveExclusions}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            spellCheck={false}
          />
        }
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

export function SettingsModal({
  onClose,
  closing,
  onProjectsRootChanged,
}: {
  onClose: () => void;
  closing: boolean;
  onProjectsRootChanged: () => void;
}) {
  return (
    <div className={`st-overlay${closing ? " closing" : ""}`}>
      <div className="st-modal">
        <header className="st-tabs">
          {tabs.map(({ icon: Icon, label, active }) => (
            <button key={label} className={`st-tab${active ? " active" : ""}`}>
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
          <button className="st-close" onClick={onClose} title="Fechar">
            <X size={16} />
          </button>
        </header>

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
      </div>
    </div>
  );
}
