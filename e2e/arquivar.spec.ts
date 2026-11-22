import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInTree, expect, spaceDir, test, treeItem, unique } from "./app";

test.describe("Arquivar", () => {
  test("arquiva um projeto (sai da árvore e vai para Arquivados) e desarquiva de volta para a pasta", async ({
    app,
  }) => {
    const folder = unique("ComArquivo");
    const project = unique("Arquivavel");
    await createInTree(app, "Nova pasta", folder);
    await createInTree(app, "Novo projeto", project, folder);

    // Arquivar pelo botão direito.
    await treeItem(app, project).click({ button: "right" });
    await app.getByText("Arquivar", { exact: true }).click();

    const section = app.locator(".archive-section");
    const header = section.locator(".archive-header");
    await expect(header).toBeVisible();
    await expect.poll(() => existsSync(join(spaceDir(), "Arquivados", project))).toBe(true);
    expect(existsSync(join(spaceDir(), folder, project))).toBe(false);

    // Fora da seção o projeto não aparece; expandindo a seção, aparece.
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    const archivedRow = section.getByText(project, { exact: true });
    await expect(archivedRow).toBeVisible();
    await expect(treeItem(app, project)).toHaveCount(1); // só o da seção

    // Desarquivar: volta para a pasta de origem.
    await archivedRow.click({ button: "right" });
    await app.getByText("Desarquivar", { exact: true }).click();
    await expect(section.getByText(project, { exact: true })).toHaveCount(0);
    await expect.poll(() => existsSync(join(spaceDir(), folder, project))).toBe(true);
    await expect(treeItem(app, project)).toBeVisible();
    await expect(app.locator(".toast")).toHaveCount(0);
  });
});
