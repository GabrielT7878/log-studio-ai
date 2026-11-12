// Dados estáticos só para a UI (sem lógica ainda).

export type WorkspaceIcon = "folder" | "shield" | "flask";

export interface Workspace {
  id: string;
  name: string;
  icon: WorkspaceIcon;
  color: string;
  locked: boolean;
  terminals: number;
  active?: boolean;
}

export const workspaces: Workspace[] = [
  { id: "1", name: "Precificação Vida Inteira (CAP)", icon: "shield", color: "#5ec8d8", locked: false, terminals: 1 },
  { id: "2", name: "Dex_TV_Launcher", icon: "folder", color: "#6fcf73", locked: true, terminals: 1 },
  { id: "3", name: "Fimathe_Retraction", icon: "folder", color: "#6fcf73", locked: true, terminals: 1 },
  { id: "4", name: "Fix S20 Wifi", icon: "folder", color: "#a78bfa", locked: true, terminals: 1 },
  { id: "5", name: "Fix_Dns", icon: "folder", color: "#60a5fa", locked: true, terminals: 1 },
  { id: "6", name: "GTA_OFFLINE", icon: "folder", color: "#f59e5b", locked: true, terminals: 1, active: true },
  { id: "7", name: "Youtube_TV_Decomp", icon: "folder", color: "#a78bfa", locked: true, terminals: 1 },
  { id: "8", name: "Maestri_Decomp", icon: "flask", color: "#f5c542", locked: true, terminals: 3 },
  { id: "9", name: "Orc", icon: "folder", color: "#f472b6", locked: true, terminals: 2 },
];
