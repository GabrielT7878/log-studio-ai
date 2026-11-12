// Registro dos terminais (xterm.js + processo no backend).
//
// Cada card de terminal tem uma sessão aqui, que vive além do componente React:
// ao trocar de projeto o card desmonta, mas o xterm e o processo continuam
// (a saída segue sendo escrita no xterm). Ao voltar, o mesmo xterm é reanexado.
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Channel } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, type PtyEvent } from "./api";
import type { AgentKind } from "./canvasNodes";

const BASE_FONT_SIZE = 13;
const MIN_FONT_SIZE = 4;

const THEME = {
  background: "#1b1b1f",
  foreground: "#e6e6e6",
  cursor: "#22c55e",
  cursorAccent: "#1b1b1f",
  selectionBackground: "rgba(59, 130, 246, 0.35)",
};

export interface TerminalTarget {
  space: string;
  project: string;
  /** "script" = janela Script (roda `command` e termina). */
  agent: AgentKind | "script";
  /** Comando do Script (só para agent = "script"). */
  command?: string;
}

/** Estado de um Script: nunca rodou, rodando, terminou com 0, terminou com erro, parado pelo usuário. */
export type ScriptStatus = "idle" | "running" | "ok" | "error" | "stopped";
export interface ScriptState {
  status: ScriptStatus;
  /** Código de saída do último fim (null = desconhecido ou não terminou). */
  code: number | null;
}
const IDLE: ScriptState = { status: "idle", code: null };

interface Session extends TerminalTarget {
  id: string;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  opened: boolean;
  /** Incrementa a cada início; eventos de uma geração antiga são ignorados. */
  generation: number;
  running: boolean;
  state: ScriptState;
}

/** Quem acompanha o estado de cada sessão (janela Script). */
const listeners = new Map<string, Set<() => void>>();

function setState(s: Session, state: ScriptState) {
  s.state = state;
  listeners.get(s.id)?.forEach((fn) => fn());
}

const sessions = new Map<string, Session>();

// Ao iniciar o app (ou recarregar a página), encerra processos órfãos antes do primeiro terminal.
const ready = api.ptyKillAll().catch(() => undefined);

/** "file:///C:/pasta/x" → "C:\pasta\x" */
function fileUrlToPath(url: URL) {
  return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1").replace(/\//g, "\\");
}

/**
 * Ctrl+clique (ou Cmd) num link do terminal.
 * - http/https/mailto → abre no navegador/app padrão;
 * - file:// → mostra no Explorer (não executa o arquivo, por segurança).
 */
function openLink(event: MouseEvent, uri: string) {
  if (!event.ctrlKey && !event.metaKey) return;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return;
  }
  const action =
    url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:"
      ? openUrl(uri)
      : url.protocol === "file:"
        ? revealItemInDir(fileUrlToPath(url))
        : null;
  action?.catch((e) => console.warn("Não foi possível abrir o link:", e));
}

function createSession(id: string, target: TerminalTarget): Session {
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: BASE_FONT_SIZE,
    cursorBlink: true,
    scrollback: 5000,
    theme: THEME,
    // Links embutidos pelos programas (OSC 8), ex.: os do Claude Code.
    linkHandler: {
      activate: (event, text) => openLink(event, text),
      allowNonHttpProtocols: true,
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // URLs escritas como texto (https://...).
  term.loadAddon(new WebLinksAddon(openLink));
  const host = document.createElement("div");
  host.className = "term-host";

  const session: Session = { ...target, id, term, fit, host, opened: false, generation: 0, running: false, state: IDLE };
  // Teclado → processo (inclui as respostas automáticas do xterm, ex.: posição do cursor).
  term.onData((data) => {
    if (session.running) api.ptyWrite(id, data).catch(() => undefined);
  });
  sessions.set(id, session);
  return session;
}

async function start(s: Session) {
  // Marca a nova geração antes de qualquer espera: evita iniciar duas vezes.
  const generation = ++s.generation;
  s.running = true;
  setState(s, { status: "running", code: null });
  await ready;
  if (s.generation !== generation) return; // excluído/reiniciado enquanto esperava
  const channel = new Channel<PtyEvent>();
  channel.onmessage = (ev) => {
    if (s.generation !== generation) return; // sessão antiga (reiniciada)
    if (ev.type === "data") {
      s.term.write(ev.data);
    } else {
      s.running = false;
      const code = ev.code == null ? "" : ` (código ${ev.code})`;
      s.term.write(`\r\n\x1b[90m[processo encerrado${code}]\x1b[0m\r\n`);
      setState(s, { status: ev.code === 0 ? "ok" : "error", code: ev.code });
    }
  };
  try {
    await api.ptySpawn(s.id, s.space, s.project, s.agent, s.term.cols, s.term.rows, channel, s.command);
  } catch (e) {
    if (s.generation !== generation) return;
    s.running = false;
    s.term.write(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`);
    setState(s, { status: "error", code: null });
  }
}

/** Ajusta colunas/linhas ao tamanho do card e avisa o processo. */
function fitSession(s: Session) {
  if (!s.host.isConnected) return;
  const dims = s.fit.proposeDimensions();
  if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
  const cols = Math.max(2, dims.cols);
  const rows = Math.max(2, dims.rows);
  if (cols === s.term.cols && rows === s.term.rows) return;
  s.term.resize(cols, rows);
  if (s.running) api.ptyResize(s.id, cols, rows).catch(() => undefined);
}

function applyZoom(s: Session, zoom: number) {
  const size = Math.max(MIN_FONT_SIZE, BASE_FONT_SIZE * zoom);
  if (s.term.options.fontSize !== size) s.term.options.fontSize = size;
}

/**
 * Mostra o terminal `id` dentro de `container` (cria e inicia na primeira vez).
 * `autoStart` = false (Script): só cria/mostra; o processo inicia com `run`.
 */
export function attach(id: string, container: HTMLElement, target: TerminalTarget, zoom: number, autoStart = true) {
  const s = sessions.get(id) ?? createSession(id, target);
  container.appendChild(s.host);
  applyZoom(s, zoom);
  if (!s.opened) {
    s.term.open(s.host);
    s.opened = true;
  }
  // Espera o layout para medir o tamanho real.
  requestAnimationFrame(() => {
    fitSession(s);
    if (s.generation === 0 && autoStart) void start(s);
    else s.term.refresh(0, s.term.rows - 1);
  });
}

/** Tira o terminal da tela (o processo continua rodando). */
export function detach(id: string) {
  sessions.get(id)?.host.remove();
}

export function setZoom(id: string, zoom: number) {
  const s = sessions.get(id);
  if (s) applyZoom(s, zoom);
}

export function fit(id: string) {
  const s = sessions.get(id);
  if (s) fitSession(s);
}

export function focus(id: string) {
  sessions.get(id)?.term.focus();
}

/** Encerra o processo e roda o comando de novo (limpa a tela). */
export function restart(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  s.term.reset();
  void start(s);
}

/** Encerra o processo e descarta o terminal (card excluído). */
export function kill(id: string) {
  const s = sessions.get(id);
  api.ptyKill(id).catch(() => undefined);
  if (!s) return;
  s.generation++;
  s.running = false;
  s.term.dispose();
  s.host.remove();
  sessions.delete(id);
  listeners.delete(id);
}

// ---------------- Script ----------------

/** Roda (ou roda de novo) o Script com o comando atual; limpa os logs. */
export function run(id: string, target: TerminalTarget) {
  const s = sessions.get(id) ?? createSession(id, target);
  s.command = target.command;
  s.space = target.space;
  s.project = target.project;
  s.term.reset();
  fitSession(s);
  void start(s);
}

/** Para o processo do Script (os logs ficam). */
export function stop(id: string) {
  const s = sessions.get(id);
  if (!s || !s.running) return;
  s.generation++; // ignora o "exit" do processo encerrado
  s.running = false;
  api.ptyKill(id).catch(() => undefined);
  s.term.write("\r\n\x1b[90m[parado]\x1b[0m\r\n");
  setState(s, { status: "stopped", code: null });
}

export function scriptState(id: string): ScriptState {
  return sessions.get(id)?.state ?? IDLE;
}

/** Avisa quando o estado do Script muda. Devolve a função para parar de ouvir. */
export function onScriptState(id: string, fn: () => void) {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

/** Últimas `n` linhas da saída (texto puro, sem cores). */
export function readLines(id: string, n: number): string[] {
  const s = sessions.get(id);
  if (!s) return [];
  const buf = s.term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    // Linha quebrada pela largura do terminal: junta com a anterior.
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-n);
}
