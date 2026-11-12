// Abre o build de testes do app com a porta CDP do WebView2 e uma pasta de projetos temporária;
// fecha o app e apaga a pasta no fim.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CDP_PORT, CDP_URL } from "./constants";

const EXE = fileURLToPath(new URL("../src-tauri/target/debug/log-studio-ai.exe", import.meta.url));

async function waitForCdp(app: ChildProcess, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (app.exitCode !== null) throw new Error(`O app fechou ao iniciar (código ${app.exitCode}).`);
    try {
      const res = await fetch(`${CDP_URL}/json/list`);
      const pages = (await res.json()) as { type: string }[];
      if (pages.some((p) => p.type === "page")) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`O app não abriu a porta CDP ${CDP_PORT} em ${timeoutMs / 1000}s.`);
}

export default async function globalSetup() {
  if (process.platform !== "win32") throw new Error("Os testes e2e só rodam no Windows (WebView2).");
  if (!existsSync(EXE)) throw new Error(`Build de testes não encontrado: ${EXE}\nRode antes: npm run e2e:build`);

  const root = mkdtempSync(join(tmpdir(), "logstudio-e2e-"));
  process.env.LOGSTUDIO_PROJECTS_ROOT = root; // os testes leem daqui

  const app = spawn(EXE, [], {
    env: {
      ...process.env,
      LOGSTUDIO_PROJECTS_ROOT: root,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT} --remote-allow-origins=*`,
    },
    stdio: "inherit",
  });
  await waitForCdp(app, 60_000);

  return async () => {
    app.kill();
    await new Promise((r) => setTimeout(r, 1000));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
}
