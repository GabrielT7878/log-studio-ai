import { createInTree, expect, test, treeItem, unique } from "./app";

test.describe("Janela Script", () => {
  test("roda o comando, mostra os logs e o status (erro e sucesso)", async ({ app }) => {
    const project = unique("Scripts");
    await createInTree(app, "Novo projeto", project);
    await treeItem(app, project).click();

    // Ferramenta Script: um clique cria a janela já com o campo do comando.
    await app.getByTitle("Script", { exact: true }).click();
    const box = (await app.locator(".canvas").boundingBox())!;
    await app.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    const node = app.locator(".sc-node").last();
    const editor = node.locator(".sc-editor-input");
    await expect(editor).toBeFocused();

    // Sai com código 2 → bolinha vermelha (classe sc-error) e a saída nos logs.
    await editor.fill("Write-Output LOGSTUDIO_SCRIPT_ERRO; exit 2");
    await node.getByRole("button", { name: "Salvar" }).click();
    await node.getByTitle("Executar", { exact: true }).click();
    await expect(node.locator(".xterm-rows")).toContainText("LOGSTUDIO_SCRIPT_ERRO", { timeout: 30_000 });
    await expect(node).toHaveClass(/\bsc-error\b/, { timeout: 30_000 });
    await expect(node.locator(".sc-dot")).toHaveAttribute("title", "Erro (código 2)");

    // Editar o comando e rodar de novo: termina com 0.
    await app.locator(".node-toolbar").getByTitle("Editar comando", { exact: true }).click();
    await node.locator(".sc-editor-input").fill("Write-Output LOGSTUDIO_SCRIPT_OK");
    await node.getByRole("button", { name: "Salvar" }).click();
    await node.getByTitle("Executar", { exact: true }).click();
    await expect(node.locator(".xterm-rows")).toContainText("LOGSTUDIO_SCRIPT_OK", { timeout: 30_000 });
    await expect(node).toHaveClass(/\bsc-ok\b/, { timeout: 30_000 });

    // Recolher: fica só o botão, com o comando resumido.
    await node.getByTitle("Recolher", { exact: true }).click();
    await expect(node.locator(".sc-body")).toHaveCount(0);
    await expect(node.locator(".sc-cmd")).toHaveText("Write-Output LOGSTUDIO_SCRIPT_OK");
  });
});
