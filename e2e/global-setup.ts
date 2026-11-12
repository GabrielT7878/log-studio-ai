// Abre o build de testes do app com a porta CDP do WebView2 e uma pasta de projetos temporária;
// fecha o app e apaga a pasta no fim.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CDP_PORT, CDP_URL } from "./constants";

const EXE = fileURLToPath(new URL("../src-tauri/target/debug/log-studio-ai.exe", import.meta.url));

async function waitForCdp(app: ChildProcess, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  let last = "nenhuma resposta";
  while (Date.now() < until) {
    if (app.exitCode !== null) throw new Error(`O app fechou ao iniciar (código ${app.exitCode}).`);
    try {
      const res = await fetch(`${CDP_URL}/json/list`);
      const body = await res.text();
      last = `HTTP ${res.status}: ${body.slice(0, 300)}`;
      const pages = JSON.parse(body) as { type: string }[];
      if (pages.some((p) => p.type === "page")) return;
    } catch (e) {
      last = e instanceof Error ? `${e.message}${e.cause ? ` (${String(e.cause)})` : ""}` : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`O app não abriu a porta CDP ${CDP_PORT} em ${timeoutMs / 1000}s. Última tentativa: ${last}`);
}

/**
 * App não abriu a porta: com ele ainda vivo, lista os processos (app, WebView2 e filhos), as
 * portas abertas pelo app e salva um print da tela em test-results/ (para o CI).
 */
function diagnose(pid: number | undefined) {
  const out = fileURLToPath(new URL("../test-results/", import.meta.url));
  mkdirSync(out, { recursive: true });
  const script = `
    "--- processos (app e WebView2)"
    Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'log-studio-ai.exe','msedgewebview2.exe','WerFault.exe' -or $_.ParentProcessId -eq ${pid ?? 0} } |
      ForEach-Object { "{0} {1} pai={2} :: {3}" -f $_.ProcessId, $_.Name, $_.ParentProcessId, ("$($_.CommandLine)".Substring(0, [Math]::Min(400, "$($_.CommandLine)".Length))) }
    "--- portas abertas pelo app"
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq ${pid ?? 0} -or (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name -eq 'msedgewebview2' } | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String
    "--- janelas visíveis"
    Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize | Out-String
    "--- print"
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save('${join(out, "tela-durante-espera.png")}')
  `;
  try {
    const text = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf-8" });
    console.log(text);
    writeFileSync(join(out, "diagnostico.txt"), text);
  } catch (e) {
    console.log("[e2e] diagnóstico falhou:", e);
  }
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
  console.log(`[e2e] app iniciado (pid ${app.pid}), pasta de projetos: ${root}`);
  try {
    await waitForCdp(app, 120_000);
  } catch (e) {
    diagnose(app.pid);
    app.kill();
    throw e;
  }

  return async () => {
    app.kill();
    await new Promise((r) => setTimeout(r, 1000));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
}
