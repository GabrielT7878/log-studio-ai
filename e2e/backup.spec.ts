import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { closeSettings, createInTree, expect, openSettings, spaceDir, test, treeItem, unique } from "./app";

test.describe("Backup", () => {
  test("faz backup pela tela de Configurações e restaura numa pasta nova, com o canvas", async ({ app }) => {
    // Projeto com uma janela de anexo (canvas no .logstudio.json + arquivo em .logstudio/anexos).
    const project = unique("Backup");
    await createInTree(app, "Novo projeto", project);
    await treeItem(app, project).click();
    await app.locator(".canvas").click({ position: { x: 300, y: 300 } });
    await app.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["a,b\n1,2\n"], "dados.csv", { type: "text/csv" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });
    await expect(app.locator(".attachment-node").last().locator(".at-name")).toHaveText("dados.csv");

    await openSettings(app);
    const modal = app.locator(".st-modal");
    await modal.getByRole("button", { name: "Fazer backup agora" }).click();
    await expect(modal.locator(".st-ok")).toContainText("Backup concluído", { timeout: 30_000 });

    const dir = process.env.LOGSTUDIO_BACKUP_DIR!;
    const zips = readdirSync(dir).filter((n) => n.startsWith("LogStudio-backup-") && n.endsWith(".zip"));
    expect(zips.length).toBeGreaterThan(0);
    expect(readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(false);

    // O mais novo fica no topo da lista; restaurar pede confirmação.
    const list = modal.getByRole("list", { name: "Backups" });
    await list.getByRole("button", { name: "Restaurar…" }).first().click();
    await list.getByRole("button", { name: "Restaurar", exact: true }).click();
    const restored = modal.locator(".st-restored");
    await expect(restored).toBeVisible({ timeout: 30_000 });
    const target = (await restored.getAttribute("title"))!;

    const root = process.env.LOGSTUDIO_PROJECTS_ROOT!;
    expect(basename(target).startsWith(`${basename(root)}-restaurado-`)).toBe(true);
    const space = basename(spaceDir());
    const meta = readFileSync(join(target, space, ".logstudio.json"), "utf-8");
    expect(meta).toContain(project);
    expect(meta).toContain("dados.csv");
    const anexos = join(target, space, project, ".logstudio", "anexos");
    expect(existsSync(anexos) && readdirSync(anexos).some((n) => n.endsWith(".csv"))).toBe(true);

    await closeSettings(app);
  });

  test("liga e desliga o backup automático e a escolha fica salva", async ({ app }) => {
    await openSettings(app);
    const toggle = app.getByRole("switch", { name: "Backup automático" });
    // Nos testes e2e o automático vem desligado por padrão — mas as configurações do
    // build de testes ficam salvas entre execuções, então parte do estado atual.
    await expect(toggle).toHaveAttribute("aria-checked", /true|false/);
    const before = await toggle.getAttribute("aria-checked");
    const after = before === "true" ? "false" : "true";
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", after);

    await closeSettings(app);
    await openSettings(app);
    await expect(toggle).toHaveAttribute("aria-checked", after);

    await toggle.click(); // volta ao estado anterior (o app é compartilhado entre os testes)
    await expect(toggle).toHaveAttribute("aria-checked", before!);
    await closeSettings(app);
  });
});
