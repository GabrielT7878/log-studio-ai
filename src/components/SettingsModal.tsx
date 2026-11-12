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
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";

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

function Toggle({ on = false }: { on?: boolean }) {
  return <button className={`st-toggle${on ? " on" : ""}`} role="switch" aria-checked={on} />;
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
