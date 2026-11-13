import { createInTree, expect, test, treeItem, unique } from "./app";

test.describe("Título do anexo", () => {
  test("renomeia a janela de anexo sem perder o nome do arquivo", async ({ app }) => {
    const project = unique("Anexo");
    await createInTree(app, "Novo projeto", project);
    await treeItem(app, project).click();

    // Cola um arquivo no canvas (o mesmo caminho do Ctrl+V): vira uma janela de anexo.
    await app.locator(".canvas").click({ position: { x: 300, y: 300 } });
    await app.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["a,b\n1,2\n"], "dados.csv", { type: "text/csv" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });
    const node = app.locator(".attachment-node").last();
    const name = node.locator(".at-name");
    await expect(name).toHaveText("dados.csv");

    // Selecionado: a barra tem "Renomear"; o cabeçalho vira campo de edição.
    await name.click();
    await app.locator(".node-toolbar").getByTitle("Renomear", { exact: true }).click();
    const input = node.locator(".at-header input");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("dados.csv");
    await input.fill("Vendas do mês");
    await input.press("Enter");

    await expect(name).toHaveText("Vendas do mês");
    await expect(name).toHaveAttribute("title", "Arquivo: dados.csv");

    // Esc cancela a edição e mantém o título.
    await app.locator(".node-toolbar").getByTitle("Renomear", { exact: true }).click();
    await input.fill("outro");
    await input.press("Escape");
    await expect(name).toHaveText("Vendas do mês");
  });
});
