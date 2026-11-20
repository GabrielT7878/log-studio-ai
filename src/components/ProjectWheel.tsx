import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../hooks/usePresence";
import type { ProjectNode, TreeNode } from "../hooks/useWorkspaceTree";

// Roda de troca de projeto (Ctrl+Tab): segura Ctrl, Tab/Shift+Tab ou o mouse escolhem,
// soltar o Ctrl abre o projeto escolhido. Esc cancela. Mostra os recentes do espaço atual.

const MAX_RECENT = 8;
const SIZE = 440; // px do SVG
const C = SIZE / 2;
const R_IN = 112;
const R_OUT = 206;
const GAP_DEG = 1.6; // espaço entre fatias
const EXIT_MS = 160;
/** Vetor de cada seta na tela (y para baixo). Duas setas juntas somam → diagonal. */
const ARROW_VEC: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, -1],
};

/** Fatia cujo centro aponta mais perto de `deg` (a fatia i fica em -90 + i·passo). */
function sliceToward(deg: number, n: number) {
  const step = 360 / n;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const diff = Math.abs((((-90 + i * step - deg) % 360) + 540) % 360 - 180);
    if (diff < bestDist - 0.001) {
      best = i;
      bestDist = diff;
    }
  }
  return best;
}

const recentKey = (space: string) => `pw-recent:${space}`;

function readRecent(space: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(space)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Coloca `id` no topo do histórico de recentes do espaço. */
export function touchRecentProject(space: string, id: string) {
  try {
    const list = [id, ...readRecent(space).filter((x) => x !== id)].slice(0, 32);
    localStorage.setItem(recentKey(space), JSON.stringify(list));
  } catch {
    // sem armazenamento: a roda usa a ordem da árvore
  }
}

function flattenProjects(nodes: TreeNode[], out: ProjectNode[] = []): ProjectNode[] {
  for (const n of nodes) {
    if (n.kind === "project") out.push(n);
    else flattenProjects(n.children, out);
  }
  return out;
}

/** Recentes primeiro; completa com os demais da árvore até MAX_RECENT. */
function recentProjects(space: string, tree: TreeNode[]): ProjectNode[] {
  const all = flattenProjects(tree);
  const byId = new Map(all.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: ProjectNode[] = [];
  for (const id of readRecent(space)) {
    const p = byId.get(id);
    if (p && !seen.has(id)) {
      out.push(p);
      seen.add(id);
    }
  }
  for (const p of all) if (!seen.has(p.id)) out.push(p);
  return out.slice(0, MAX_RECENT);
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (r: number, deg: number) => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))];

/** Fatia de anel entre os ângulos a0 e a1 (graus, 0 = direita, sentido horário). */
function slicePath(a0: number, a1: number) {
  const [x0, y0] = pt(R_OUT, a0);
  const [x1, y1] = pt(R_OUT, a1);
  const [x2, y2] = pt(R_IN, a1);
  const [x3, y3] = pt(R_IN, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${R_OUT} ${R_OUT} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${R_IN} ${R_IN} 0 ${large} 0 ${x3} ${y3}Z`;
}

const initials = (name: string) =>
  name
    .split(/[\s\-_.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function ProjectWheel({
  space,
  tree,
  activeId,
  onSelect,
}: {
  space: string | null;
  tree: TreeNode[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const [items, setItems] = useState<ProjectNode[] | null>(null);
  const [sel, setSel] = useState(0);
  const presence = usePresence(items !== null, EXIT_MS);
  // Última lista aberta: continua desenhada durante a animação de saída.
  const shownRef = useRef<ProjectNode[]>([]);
  if (items) shownRef.current = items;
  const shown = shownRef.current;

  const latest = useRef({ space, tree, activeId, onSelect, items, sel });
  latest.current = { space, tree, activeId, onSelect, items, sel };
  const wheelRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // Posição do mouse quando a roda abriu / na última escolha pelo mouse. O WebView dispara
    // mousemove "fantasma" quando o conteúdo sob o cursor muda (ex.: a fatia destacada):
    // sem isso, ele desfaria a escolha feita pelo teclado.
    let mouseBase: { x: number; y: number } | null = null;
    const MOUSE_SLOP = 6; // px que o mouse precisa andar para assumir a seleção
    // Setas seguras agora (para combinar duas em diagonal).
    const arrowsDown = new Set<string>();

    const close = (confirm: boolean) => {
      const { items, sel, activeId, onSelect } = latest.current;
      if (!items) return;
      const target = items[sel];
      setItems(null);
      if (confirm && target && target.id !== activeId) onSelect(target.id);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const { items, space, tree, activeId } = latest.current;
      if (e.key === "Tab" && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        if (items) {
          const n = items.length;
          setSel((s) => (s + (e.shiftKey ? -1 : 1) + n) % n);
          return;
        }
        if (!space || document.querySelector(".st-overlay")) return;
        const list = recentProjects(space, tree);
        if (list.length === 0) return;
        const cur = list.findIndex((p) => p.id === activeId);
        // Começa no anterior ao atual (como Alt+Tab): Ctrl+Tab rápido alterna entre os dois.
        setSel(list.length > 1 ? (cur === 0 ? 1 : 0) : 0);
        setItems(list);
        mouseBase = null;
        arrowsDown.clear();
        return;
      }
      if (!items) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key in ARROW_VEC) {
        // Setas apontam: ← escolhe a fatia mais à esquerda, ↑ + → a de cima à direita, etc.
        e.preventDefault();
        e.stopPropagation();
        arrowsDown.add(e.key);
        let x = 0;
        let y = 0;
        for (const k of arrowsDown) {
          x += ARROW_VEC[k]![0];
          y += ARROW_VEC[k]![1];
        }
        if (x === 0 && y === 0) return; // setas opostas se anulam
        setSel(sliceToward((Math.atan2(y, x) * 180) / Math.PI, items.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key !== "Control" && e.key !== "Meta" && e.key !== "Shift") {
        // Outras teclas não vão para o terminal/canvas enquanto a roda está aberta.
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Soltar uma seta não muda a seleção: ao sair de uma diagonal, as duas setas raramente
      // são soltas no mesmo instante, e a diagonal escolhida deve ficar.
      arrowsDown.delete(e.key);
      if (!latest.current.items) return;
      if (e.key in ARROW_VEC) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "Control" || e.key === "Meta") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };

    const onMove = (e: MouseEvent) => {
      const { items } = latest.current;
      const el = wheelRef.current;
      if (!items || !el) return;
      if (!mouseBase) {
        mouseBase = { x: e.screenX, y: e.screenY };
        return;
      }
      if (Math.hypot(e.screenX - mouseBase.x, e.screenY - mouseBase.y) < MOUSE_SLOP) return;
      mouseBase = { x: e.screenX, y: e.screenY };
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < (R_IN * r.width) / SIZE * 0.6) return; // zona morta no centro
      const step = 360 / items.length;
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90; // 0 = topo
      setSel(((Math.round(deg / step) % items.length) + items.length) % items.length);
    };

    const onBlur = () => close(false);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const geometry = useMemo(() => {
    const n = shown.length;
    const step = 360 / n;
    return shown.map((p, i) => {
      const mid = -90 + i * step;
      const gap = n > 1 ? GAP_DEG : 0;
      const a0 = n > 1 ? mid - step / 2 + gap / 2 : -90;
      const a1 = n > 1 ? mid + step / 2 - gap / 2 : 269.99;
      const [lx, ly] = pt((R_IN + R_OUT) / 2, mid);
      // Quantos caracteres do nome cabem na largura da fatia (no raio do meio).
      const arc = rad(step) * ((R_IN + R_OUT) / 2);
      const max = Math.min(22, Math.max(6, Math.floor((arc * 0.8) / 7)));
      const label = p.name.length > max ? `${p.name.slice(0, max - 1).trimEnd()}…` : p.name;
      return { p, d: slicePath(a0, a1), lx, ly, label };
    });
  }, [shown]);

  if (!presence.mounted || shown.length === 0) return null;
  const current = shown[Math.min(sel, shown.length - 1)]!;

  const confirmIndex = (i: number) => {
    const target = shown[i];
    setItems(null);
    if (target && target.id !== activeId) onSelect(target.id);
  };

  return createPortal(
    <div
      className={`pw-overlay${presence.closing ? " closing" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setItems(null);
      }}
    >
      <div className="pw-wheel" style={{ width: SIZE, height: SIZE }}>
        <svg ref={wheelRef} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={C} cy={C} r={R_OUT + 10} className="pw-rim" />
          {geometry.map(({ p, d, lx, ly, label }, i) => {
            const on = i === sel;
            return (
              <g
                key={p.id}
                className={`pw-slice${on ? " on" : ""}${p.id === activeId ? " current" : ""}`}
                style={{ ["--pw-color" as string]: p.color }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  confirmIndex(i);
                }}
              >
                <path d={d} />
                <circle cx={lx} cy={ly - 12} r={on ? 20 : 17} className="pw-badge" />
                <text x={lx} y={ly - 12} className="pw-initials">
                  {initials(p.name)}
                </text>
                <text x={lx} y={ly + 22} className="pw-label">
                  <title>{p.name}</title>
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="pw-center">
          <span className="pw-dot" style={{ background: current.color }} />
          <div className="pw-name">{current.name}</div>
          {current.id.includes("/") && (
            <div className="pw-path">{current.id.split("/").slice(0, -1).join(" / ")}</div>
          )}
          {current.id === activeId && <div className="pw-tag">aberto</div>}
        </div>
      </div>
      <div className="pw-hint">
        <kbd>Tab</kbd> próximo · <kbd>Shift</kbd>+<kbd>Tab</kbd> anterior · <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd>{" "}
        <kbd>↓</kbd> apontam · solte <kbd>Ctrl</kbd> para abrir ·{" "}
        <kbd>Esc</kbd> cancela
      </div>
    </div>,
    document.body,
  );
}
