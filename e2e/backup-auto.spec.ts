import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_CONFIG_DIR, expect, newestBackupMs, setBackupAuto, test } from "./app";

test.describe("Backup automático", () => {
  test("ao abrir, refaz o backup que foi interrompido e descarta o .zip.tmp", async ({ app }) => {
    await setBackupAuto(app, true);
    // Simula um backup cortado no meio (queda de energia): marcador + zip parcial.
    const pending = join(E2E_CONFIG_DIR, "backup.pending");
    const tmp = join(process.env.LOGSTUDIO_BACKUP_DIR!, "LogStudio-backup-interrompido.zip.tmp");
    writeFileSync(pending, "0");
    writeFileSync(tmp, "parcial");
    const start = Date.now();
    try {
      await app.reload(); // o app "abre de novo"
      await expect(app.locator(".toast.info")).toContainText("interrompido", { timeout: 30_000 });
      expect(existsSync(pending)).toBe(false);
      expect(existsSync(tmp)).toBe(false);
      expect(newestBackupMs()).toBeGreaterThanOrEqual(start - 2000);
    } finally {
      await setBackupAuto(app, false);
    }
  });
});
