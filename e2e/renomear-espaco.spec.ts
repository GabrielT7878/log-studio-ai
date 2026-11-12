import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInTree, expect, spaceDir, test, treeItem, unique } from "./app";

/** Janelas salvas de um projeto no `.logstudio.json` do espaço. */
function savedWindows(space: string, project: string): unknown[] {
  const meta = JSON.parse(readFileSync(join(space, ".logstudio.json"), "utf-8"));
  const find = (nodes: { name: string; canvas?: unknown[]; children?: unknown[] }[]): unknown[] | undefined => {
    for (const n of nodes) {
      if (n.name === project) return n.canvas ?? [];
      const inner = find((n.children ?? []) as typeof nodes);
      if (inner) return inner;
    }
  };
  return find(meta.nodes) ?? [];
}

test("renomear o espaço mantém as janelas criadas depois de abrir o projeto", async ({ app }) => {
  const project = unique("Janelas");
  await createInTree(app, "Novo projeto", project);
  await treeItem(app, project).click();

  // Duas janelas de texto, criadas depois que a árvore do espaço foi carregada.
  const canvas = app.locator(".canvas");
  const box = (await canvas.boundingBox())!;
  for (const [i, fx, fy] of [
    [1, 0.3, 0.3],
    [2, 0.6, 0.6],
  ]) {
    await app.getByTitle("Texto", { exact: true }).click();
    await app.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await app.keyboard.type(`Janela ${i}`); // texto vazio é descartado
    await app.keyboard.press("Escape");
  }
  const windows = app.locator(".canvas-world .canvas-node");
  await expect(windows).toHaveCount(2);
  await expect.poll(() => savedWindows(spaceDir(), project).length).toBe(2);

  // Renomeia o espaço pelo menu do título do espaço.
  const oldName = basename(spaceDir());
  const newName = unique("Espaco");
  await app.locator("aside").getByText(oldName, { exact: true }).click();
  await app.getByText("Renomear espaço…", { exact: true }).click();
  await app.locator("#name-modal-input").fill(newName);
  await app.getByRole("button", { name: "Salvar" }).click();
  await expect(app.locator("aside").getByText(newName, { exact: true })).toBeVisible();

  // As duas janelas continuam no canvas…
  await expect(windows).toHaveCount(2);
  // …e no disco, mesmo depois de uma alteração qualquer (que salva o canvas).
  await windows.first().click();
  await app.keyboard.press("ArrowRight");
  await app.waitForTimeout(1000);
  expect(basename(spaceDir())).toBe(newName);
  expect(savedWindows(spaceDir(), project)).toHaveLength(2);
});
