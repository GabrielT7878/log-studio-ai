import { createInTree, expect, test, treeItem, unique } from "./app";

// Bug: focar algo de uma janela cortada na borda fazia o navegador rolar o `.canvas`
// (overflow: hidden ainda deixa rolar por código). A barra do topo, que fica dentro do
// canvas, ia junto: os botões de fechar/maximizar/minimizar saíam do lugar.
test("focar uma janela cortada na borda não rola o canvas nem desloca a barra do topo", async ({ app }) => {
  const project = unique("ScrollFoco");
  await createInTree(app, "Novo projeto", project);
  await treeItem(app, project).click();

  const canvas = app.locator(".canvas");
  const controls = app.locator(".window-controls");
  const before = (await controls.boundingBox())!;

  // Nota criada colada na borda direita (meia altura, longe das barras): fica cortada e o
  // campo recebe o foco.
  await app.getByTitle("Nota", { exact: true }).click();
  const box = (await canvas.boundingBox())!;
  await app.mouse.click(box.x + box.width - 30, box.y + box.height * 0.5);
  await expect(app.locator(".note-node").last().locator("textarea, [contenteditable]").first()).toBeFocused();
  await app.keyboard.type("foco na borda");

  const scroll = await canvas.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
  expect(scroll).toEqual({ left: 0, top: 0 });
  const after = (await controls.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});
