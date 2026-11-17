import { createInTree, expect, test, treeItem, unique } from "./app";

// O destaque do agente (.agent-mark) só aparece quando um Claude Code chama as ferramentas
// do canvas; aqui ele é inserido direto no canvas, igual ao que o Canvas desenha.
test("em tela cheia, o destaque do agente não aparece por cima da janela", async ({ app }) => {
  const project = unique("TelaCheia");
  await createInTree(app, "Novo projeto", project);
  await treeItem(app, project).click();
  await app.getByTitle("Nota", { exact: true }).click();
  const box = (await app.locator(".canvas").boundingBox())!;
  await app.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  const note = app.locator(".note-node").last();
  await expect(note).toBeVisible();

  await app.locator(".canvas-world").evaluate((world) => {
    const mark = document.createElement("div");
    mark.className = "agent-mark e2e-mark";
    mark.style.cssText = "--nx: 0; --ny: 0; --nw: 400; --nh: 300";
    world.appendChild(mark);
  });
  const mark = app.locator(".e2e-mark");
  await expect(mark).toBeVisible();

  await note.getByTitle(/^Tela cheia/).click();
  await expect(note).toHaveClass(/\bfullscreen\b/);
  await expect(mark).toBeHidden();

  // Saindo da tela cheia, o destaque volta (o usuário ainda vê o que o agente mexeu).
  await note.getByTitle(/^Sair da tela cheia/).click();
  await expect(note).not.toHaveClass(/\bfullscreen\b/);
  await expect(mark).toBeVisible();
  await mark.evaluate((el) => el.remove());
});
