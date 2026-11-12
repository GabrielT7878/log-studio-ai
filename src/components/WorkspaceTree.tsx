import { ChevronRight, Folder, FolderOpen, SquareTerminal } from "lucide-react";
import { useEffect, useRef } from "react";
import type { DropTarget } from "../hooks/useTreeDrag";
import type { FolderNode, ProjectNode, TreeNode } from "../hooks/useWorkspaceTree";

type MenuHandler<T> = (e: React.MouseEvent, node: T) => void;

/** Estado do arraste repassado para as linhas. */
export interface TreeDnd {
  dragId: string | null;
  target: DropTarget | null;
  start: (e: React.PointerEvent, id: string, label: string) => void;
}

interface TreeHandlers {
  editingId: string | null;
  dnd: TreeDnd;
  onToggle: (id: string) => void;
  /** Clique num projeto: abre o canvas dele. */
  onSelectProject: (id: string) => void;
  onRename: (id: string, name: string | null) => void;
  onFolderMenu: MenuHandler<FolderNode>;
  onProjectMenu: MenuHandler<ProjectNode>;
}

/** Classes de arraste: item sendo arrastado e indicador de onde soltar. */
function dndClass(dnd: TreeDnd, id: string) {
  let c = "";
  if (dnd.dragId === id) c += " dragging";
  if (dnd.target && dnd.target.id === id) c += ` drop-${dnd.target.pos}`;
  return c;
}

/** Campo de edição de nome inline. Enter/blur confirma, Esc cancela. */
function InlineRename({ value, onDone }: { value: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    el.scrollIntoView({ block: "nearest" });
  }, []);

  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };

  return (
    <input
      ref={ref}
      className="tree-rename"
      defaultValue={value}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function ProjectRow({ p, h }: { p: ProjectNode; h: TreeHandlers }) {
  const editing = h.editingId === p.id;
  return (
    <div
      className={`workspace-item${p.active ? " active" : ""}${dndClass(h.dnd, p.id)}`}
      data-node-id={p.id}
      data-kind="project"
      aria-current={p.active ? "true" : undefined}
      onPointerDown={(e) => !editing && h.dnd.start(e, p.id, p.name)}
      onClick={() => !editing && h.onSelectProject(p.id)}
      onContextMenu={(e) => h.onProjectMenu(e, p)}
    >
      <Folder size={18} color={p.color} strokeWidth={1.8} style={{ flexShrink: 0 }} />
      {editing ? (
        <InlineRename value={p.name} onDone={(name) => h.onRename(p.id, name)} />
      ) : (
        <span className="workspace-name">{p.name}</span>
      )}
      <span className="workspace-meta">
        <SquareTerminal size={14} />
        <span>0</span>
      </span>
    </div>
  );
}

function FolderRow({ f, h }: { f: FolderNode; h: TreeHandlers }) {
  const editing = h.editingId === f.id;
  const FolderIcon = f.expanded ? FolderOpen : Folder;

  return (
    <div className="tree-folder" data-folder-id={f.id}>
      <div
        className={`workspace-item folder-item${dndClass(h.dnd, f.id)}`}
        data-node-id={f.id}
        data-kind="folder"
        data-expanded={f.expanded}
        onPointerDown={(e) => !editing && h.dnd.start(e, f.id, f.name)}
        onClick={() => !editing && h.onToggle(f.id)}
        onContextMenu={(e) => h.onFolderMenu(e, f)}
      >
        <ChevronRight size={14} className={`tree-chevron${f.expanded ? " open" : ""}`} />
        <FolderIcon size={18} strokeWidth={1.8} className="tree-folder-icon" />
        {editing ? (
          <InlineRename value={f.name} onDone={(name) => h.onRename(f.id, name)} />
        ) : (
          <span className="workspace-name">{f.name}</span>
        )}
        <span className="workspace-meta">{f.children.length}</span>
      </div>

      <div className={`tree-children${f.expanded ? " open" : ""}`} inert={!f.expanded}>
        <div className="tree-children-inner">
          <TreeNodes nodes={f.children} h={h} />
          {f.children.length === 0 && (
            <div className="tree-empty" data-empty-folder={f.id}>
              Pasta vazia
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeNodes({ nodes, h }: { nodes: TreeNode[]; h: TreeHandlers }) {
  return (
    <>
      {nodes.map((n) =>
        n.kind === "folder" ? <FolderRow key={n.id} f={n} h={h} /> : <ProjectRow key={n.id} p={n} h={h} />,
      )}
    </>
  );
}

export function WorkspaceTree({ tree, ...h }: TreeHandlers & { tree: TreeNode[] }) {
  return <TreeNodes nodes={tree} h={h} />;
}
