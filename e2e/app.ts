// Fixture `app`: a página do app (conectada via CDP), com trace e print salvos quando o teste falha.
// Também traz atalhos para a barra lateral e o canvas.
import { test as base, chromium, expect, type Page } from "@playwright/test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CDP_URL } from "./constants";

export const test = base.extend<{ app: Page }>({
  app: async ({}, use, testInfo) => {
    const browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => !p.url().startsWith("devtools"))!;
    await context.tracing.start({ screenshots: true, snapshots: true });
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      await page.screenshot({ path: testInfo.outputPath("falha.png") }).catch(() => {});
      await context.tracing.stop({ path: testInfo.outputPath("trace.zip") });
    } else {
      await context.tracing.stop();
    }
    await browser.close(); // só desconecta; o app continua aberto para o próximo teste
  },
});

export { expect };

/** Nome único por execução (o app é compartilhado entre os testes). */
export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;

/** Pasta do espaço de trabalho no disco (a raiz temporária tem um só espaço). */
export function spaceDir() {
  const root = process.env.LOGSTUDIO_PROJECTS_ROOT!;
  const space = readdirSync(root).find((n) => statSync(join(root, n)).isDirectory());
  if (!space) throw new Error(`Nenhum espaço em ${root}`);
  return join(root, space);
}

/** Item da árvore da barra lateral pelo nome. */
export const treeItem = (page: Page, name: string) => page.locator("aside").getByText(name, { exact: true });

/** Cria uma pasta (ou projeto) pelo menu de botão direito — na raiz ou dentro de `parent`. */
export async function createInTree(page: Page, kind: "Nova pasta" | "Novo projeto", name: string, parent?: string) {
  if (parent) await treeItem(page, parent).click({ button: "right" });
  else await page.locator("aside").click({ button: "right", position: { x: 200, y: 500 } });
  await page.getByText(kind, { exact: true }).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await expect(treeItem(page, name)).toBeVisible();
}

/** Exclui um item da árvore pelo menu de botão direito + confirmação. */
export async function deleteInTree(page: Page, name: string) {
  await treeItem(page, name).click({ button: "right" });
  await page.getByText("Excluir", { exact: true }).click();
  await page.getByRole("button", { name: "Mover para a Lixeira" }).click();
}

/** Abre o projeto e cria um terminal PowerShell no canvas; espera o prompt aparecer. */
export async function openShellTerminal(page: Page, project: string) {
  await treeItem(page, project).click();
  await page.getByTitle("Terminal", { exact: true }).click();
  const box = (await page.locator(".canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.getByText("Terminal (PowerShell)", { exact: true }).click();
  await expect(page.locator(".xterm-rows").first()).toContainText("PS ", { timeout: 30_000 });
}
