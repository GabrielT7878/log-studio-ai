import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInTree, deleteInTree, expect, openShellTerminal, spaceDir, test, treeItem, unique } from "./app";

test.describe("Excluir pasta pela barra lateral", () => {
  test("com terminal aberto num projeto dentro dela: encerra o terminal e manda para a Lixeira", async ({ app }) => {
    const folder = unique("ComTerminal");
    const project = unique("Projeto");
    await createInTree(app, "Nova pasta", folder);
    await createInTree(app, "Novo projeto", project, folder);
    await openShellTerminal(app, project);

    const dir = join(spaceDir(), folder);
    expect(existsSync(join(dir, project))).toBe(true);

    await deleteInTree(app, folder);

    await expect(treeItem(app, folder)).toHaveCount(0);
    await expect(app.locator(".toast")).toHaveCount(0);
    await expect.poll(() => existsSync(dir)).toBe(false);
  });

  test("em uso por outro programa: mostra o aviso e mantém a pasta", async ({ app }) => {
    const folder = unique("EmUso");
    await createInTree(app, "Nova pasta", folder);
    const dir = join(spaceDir(), folder);
    mkdirSync(dir, { recursive: true });

    // Um PowerShell de fora do app "segura" a pasta (cwd dentro dela).
    const holder = spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep 120"], {
      cwd: dir,
      stdio: "ignore",
    });
    try {
      await new Promise((r) => setTimeout(r, 1500));
      await deleteInTree(app, folder);
      await expect(app.locator(".toast")).toContainText("A pasta está em uso por outro programa");
      await expect(treeItem(app, folder)).toBeVisible();
      expect(existsSync(dir)).toBe(true);
    } finally {
      holder.kill();
    }

    // Liberada, a exclusão funciona.
    await new Promise((r) => setTimeout(r, 1000));
    await expect(app.locator(".toast")).toHaveCount(0, { timeout: 15_000 });
    await deleteInTree(app, folder);
    await expect(treeItem(app, folder)).toHaveCount(0);
    await expect.poll(() => existsSync(dir)).toBe(false);
  });
});
