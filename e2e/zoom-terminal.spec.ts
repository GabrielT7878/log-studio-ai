import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { createInTree, expect, openShellTerminal, spaceDir, test, unique } from "./app";

/** Tamanho da fonte do xterm na tela (px). */
const xtermFontSize = (node: Locator) =>
  node.locator(".xterm-rows").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

/** `fontSize` salvo da janela `id` no .logstudio.json do espaço. */
function savedFontSize(id: string): number | undefined {
  const found: number[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.id === id && typeof o.fontSize === "number") found.push(o.fontSize);
      Object.values(o).forEach(walk);
    }
  };
  walk(JSON.parse(readFileSync(join(spaceDir(), ".logstudio.json"), "utf8")));
  return found[0];
}

test("Ctrl + roda no terminal selecionado muda a fonte dele e salva", async ({ app }) => {
  const project = unique("ZoomTerminal");
  await createInTree(app, "Novo projeto", project);
  await openShellTerminal(app, project);

  const node = app.locator(".term-node").last();
  const id = (await node.getAttribute("data-node-id"))!;
  await node.locator(".term-header").click(); // seleciona
  await expect(node).toHaveClass(/\bselected\b/);
  const zoomBefore = (await app.locator(".zoom-value").textContent())!;
  const before = await xtermFontSize(node);

  // Ctrl + roda para cima sobre o terminal: 13 → 16.
  const box = (await node.locator(".term-body").boundingBox())!;
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.keyboard.down("Control");
  for (let i = 0; i < 3; i++) await app.mouse.wheel(0, -100);
  await app.keyboard.up("Control");

  await expect.poll(() => xtermFontSize(node)).toBeGreaterThan(before);
  // O canvas não deu zoom.
  await expect(app.locator(".zoom-value")).toHaveText(zoomBefore);
  // Salvo no disco.
  await expect.poll(() => savedFontSize(id), { timeout: 10_000 }).toBe(16);
});
