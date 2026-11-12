import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas, type ActiveProject } from "./components/Canvas";
import { SettingsModal } from "./components/SettingsModal";
import { NewGroupModal } from "./components/NewGroupModal";
import { usePresence } from "./hooks/usePresence";
import "./App.css";

const MODAL_EXIT_MS = 160;

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
    </div>
  );
}

export default App;
