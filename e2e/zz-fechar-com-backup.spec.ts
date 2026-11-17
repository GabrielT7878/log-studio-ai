// Fecha o app de testes (compartilhado): por isso o nome começa com "zz" — os arquivos
// rodam em ordem alfabética com 1 worker, e este precisa ser o último.
import { test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { CDP_URL } from "./constants";
import { E2E_CONFIG_DIR, createInTree, expect, newestBackupMs, setBackupAuto, unique } from "./app";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Manda WM_CLOSE para a janela do app — o mesmo que clicar no X. */
function clickWindowClose(pid: number) {
  const script = `
    $h = (Get-Process -Id ${pid}).MainWindowHandle
    if ($h -eq 0) { throw "Janela do app não encontrada" }
    Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);'
    [U.W]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", script]);
}

/** Desliga o automático direto no settings.json (o app já fechou). */
function resetAutoInSettings() {
  const file = join(E2E_CONFIG_DIR, "settings.json");
  if (!existsSync(file)) return;
  const s = JSON.parse(readFileSync(file, "utf-8"));
  s.backup = { ...(s.backup ?? {}), auto: false };
  writeFileSync(file, JSON.stringify(s, null, 2));
}

test("ao fechar a janela, faz o backup e só então fecha o app", async () => {
  // Sem a fixture `app`: ela fecha o trace pela conexão CDP, que morre junto com o app.
  const browser = await chromium.connectOverCDP(CDP_URL);
  const page = browser.contexts()[0].pages().find((p) => !p.url().startsWith("devtools"))!;
  const pid = Number(process.env.LOGSTUDIO_E2E_PID);
  try {
    await setBackupAuto(page, true);
    await createInTree(page, "Novo projeto", unique("Fechar")); // uma mudança desde o último backup
    const start = Date.now();

    clickWindowClose(pid);
    await expect.poll(() => alive(pid), { timeout: 60_000 }).toBe(false);

    expect(newestBackupMs()).toBeGreaterThanOrEqual(start - 2000);
    expect(existsSync(join(E2E_CONFIG_DIR, "backup.pending"))).toBe(false);
  } finally {
    if (!alive(pid)) resetAutoInSettings();
    else await setBackupAuto(page, false).catch(() => {});
    await browser.close().catch(() => {});
  }
});
