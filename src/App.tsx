import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas, type ActiveProject } from "./components/Canvas";
import { SettingsModal } from "./components/SettingsModal";
import { NewGroupModal } from "./components/NewGroupModal";
import { UpdateBanner } from "./components/UpdateBanner";
import { BackupCloseOverlay } from "./components/BackupCloseOverlay";
import { usePresence } from "./hooks/usePresence";
import { useUpdater } from "./hooks/useUpdater";
import { useAutoBackup } from "./hooks/useAutoBackup";
import { useToast } from "./hooks/useToast";
import "./App.css";

const MODAL_EXIT_MS = 160;
/** Tempo para os salvamentos disparados ao desmontar (canvas, quadros) terminarem antes de instalar. */
const SAVE_BEFORE_INSTALL_MS = 1200;

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Incrementa quando o diretório raiz dos projetos muda → a sidebar recarrega a árvore.
  const [rootVersion, setRootVersion] = useState(0);
  // Projeto aberto no canvas (escolhido na sidebar).
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);

  const settings = usePresence(settingsOpen, MODAL_EXIT_MS);
  const newGroup = usePresence(newGroupOpen, MODAL_EXIT_MS);

  const updater = useUpdater();
  const backupToast = useToast(6000);
  useAutoBackup(backupToast.show);
  // Ao instalar: desmonta o app (os efeitos de limpeza salvam o que estiver pendente) e espera.
  const [closingForUpdate, setClosingForUpdate] = useState(false);
  const restartForUpdate = () =>
    updater.installAndRestart(() => {
      setClosingForUpdate(true);
      return new Promise((r) => setTimeout(r, SAVE_BEFORE_INSTALL_MS));
    });

  if (closingForUpdate) {
    return <div className="app update-screen">Atualizando o Log Studio AI…</div>;
  }

  return (
    <div className="app">
      <Sidebar
        collapsed={sidebarCollapsed}
        rootVersion={rootVersion}
        onActiveProjectChange={setActiveProject}
        onOpenSettings={() => setSettingsOpen(true)}
        onNewGroup={() => setNewGroupOpen(true)}
      />
      <Canvas
        project={activeProject}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
      />
      {settings.mounted && (
        <SettingsModal
          closing={settings.closing}
          onClose={() => setSettingsOpen(false)}
          onProjectsRootChanged={() => setRootVersion((v) => v + 1)}
        />
      )}
      {newGroup.mounted && (
        <NewGroupModal closing={newGroup.closing} onClose={() => setNewGroupOpen(false)} />
      )}
      <BackupCloseOverlay />
      {backupToast.presence.mounted && (
        <div
          className={`toast info${backupToast.presence.closing ? " closing" : ""}`}
          role="status"
          onClick={backupToast.hide}
        >
          {backupToast.message}
        </div>
      )}
      {!updater.dismissed && (
        <UpdateBanner
          state={updater.state}
          onDownload={updater.download}
          onRestart={restartForUpdate}
          onDismiss={updater.dismiss}
        />
      )}
    </div>
  );
}

export default App;
