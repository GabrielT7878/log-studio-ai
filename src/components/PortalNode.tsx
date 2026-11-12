import { openUrl } from "@tauri-apps/plugin-opener";
import { FullscreenButton } from "./FullscreenButton";
import { ChevronLeft, ChevronRight, ExternalLink, Globe, RotateCw, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { PORTAL_MIN_H, PORTAL_MIN_W, type NodePatch, type PortalNodeData } from "../lib/canvasNodes";
import { dragPointer } from "../lib/dragPointer";

interface Props {
  node: PortalNodeData;
  zoom: number;
  selected: boolean;
  /** Foca a barra de endereço ao montar (portal recém-criado). */
  autoFocus: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: NodePatch) => void;
  /** Esta janela está em tela cheia. */
  fullscreen?: boolean;
  onToggleFullscreen?: (id: string) => void;
}

/**
 * Texto da barra de endereço → URL http(s). Sem esquema: https://, ou http:// para
 * localhost/IPs. Outros esquemas (javascript:, file:…) são recusados (null).
 */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : /^(localhost|127\.|0\.0\.0\.0|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/i.test(text)
      ? `http://${text}`
      : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

type Status = "idle" | "checking" | "ok" | "blocked";

/** Portal: página web dentro do canvas (iframe). */
export function PortalNode({ node, zoom, selected, autoFocus, onSelect, onChange, fullscreen = false, onToggleFullscreen }: Props) {
  const [address, setAddress] = useState(node.url);
  const [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState<Status>(node.url ? "checking" : "idle");
  const [reloadKey, setReloadKey] = useState(0);
  // Histórico dos endereços digitados (o app não enxerga a navegação dentro de outro site).
  const [history, setHistory] = useState({ stack: node.url ? [node.url] : [], index: node.url ? 0 : -1 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao criar
  }, []);

  // Mudou a URL: mostra no campo e confere se o site permite ser embutido.
  useEffect(() => {
    setAddress(node.url);
    if (!node.url) {
      setStatus("idle");
      return;
    }
    let alive = true;
    setStatus("checking");
    api
      .portalCheck(node.url)
      .then((r) => alive && setStatus(r.blocked ? "blocked" : "ok"))
      .catch(() => alive && setStatus("ok"));
    return () => {
      alive = false;
    };
  }, [node.url]);

  const navigate = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (url === node.url) {
      setReloadKey((k) => k + 1);
      return;
    }
    setHistory((h) => ({ stack: [...h.stack.slice(0, h.index + 1), url], index: h.index + 1 }));
    onChange(node.id, { url });
  };

  const step = (delta: number) => {
    const index = history.index + delta;
    if (index < 0 || index >= history.stack.length) return;
    setHistory({ ...history, index });
    onChange(node.id, { url: history.stack[index] });
  };

  const openExternal = () => {
    if (node.url) openUrl(node.url).catch((e) => console.warn(e));
  };

  /** Arrastar pelo espaço vazio do cabeçalho move o card. */
  const onHeaderDown = (e: React.PointerEvent<HTMLElement>) => {
    onSelect(node.id);
    if (e.target !== e.currentTarget) return;
    const { x, y } = node;
    dragPointer(e, (dx, dy) => onChange(node.id, { x: x + dx / zoom, y: y + dy / zoom }));
  };

  const startResize = (e: React.PointerEvent) => {
    onSelect(node.id);
    const { w, h } = node;
    dragPointer(e, (dx, dy) =>
      onChange(node.id, { w: Math.max(PORTAL_MIN_W, w + dx / zoom), h: Math.max(PORTAL_MIN_H, h + dy / zoom) }),
    );
  };

  return (
    <div
      className={`canvas-node portal-node${selected ? " selected" : ""}${fullscreen ? " fullscreen" : ""}`}
      data-node-id={node.id}
      style={
        {
          "--nx": node.x,
          "--ny": node.y,
          "--nw": node.w,
          "--nh": node.h,
          zIndex: selected ? 2 : 1,
        } as React.CSSProperties
      }
      onPointerDown={() => onSelect(node.id)}
    >
      <div className="pt-inner">
        <div className="pt-header" onPointerDown={onHeaderDown}>
          <button className="fb-icon-btn" title="Voltar" disabled={history.index <= 0} onClick={() => step(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button
            className="fb-icon-btn"
            title="Avançar"
            disabled={history.index >= history.stack.length - 1}
            onClick={() => step(1)}
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="fb-icon-btn"
            title="Recarregar"
            disabled={!node.url}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RotateCw size={14} />
          </button>
          <form
            className={`pt-address${invalid ? " invalid" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              navigate(address);
              inputRef.current?.blur();
            }}
          >
            <Globe size={13} />
            <input
              ref={inputRef}
              value={address}
              placeholder="Digite um endereço (ex.: localhost:3000)"
              spellCheck={false}
              onChange={(e) => {
                setAddress(e.target.value);
                setInvalid(false);
              }}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setAddress(node.url);
                  setInvalid(false);
                  e.currentTarget.blur();
                }
              }}
            />
          </form>
          <button className="fb-icon-btn" title="Abrir no navegador" disabled={!node.url} onClick={openExternal}>
            <ExternalLink size={15} />
          </button>
          {onToggleFullscreen && (
            <FullscreenButton active={fullscreen} size={15} onToggle={() => onToggleFullscreen(node.id)} />
          )}
        </div>

        <div className="pt-body">
          {!node.url ? (
            <div className="pt-message">
              <Globe size={28} />
              <span>Digite um endereço na barra acima e tecle Enter.</span>
            </div>
          ) : status === "blocked" ? (
            <div className="pt-message">
              <ShieldAlert size={28} />
              <span>Este site não permite ser exibido dentro do app.</span>
              <button className="pt-open-btn" onClick={openExternal}>
                <ExternalLink size={14} /> Abrir no navegador
              </button>
            </div>
          ) : (
            <iframe
              key={`${node.url}#${reloadKey}`}
              className="pt-frame"
              src={node.url}
              title={node.url}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </div>
      </div>

      <div className="node-resize" title="Redimensionar" onPointerDown={startResize} />
    </div>
  );
}
