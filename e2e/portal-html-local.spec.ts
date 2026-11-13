import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInTree, expect, spaceDir, test, treeItem, unique } from "./app";

test.describe("Portal com HTML local", () => {
  test("abre um HTML do projeto com o CSS relativo e não serve arquivos ocultos", async ({ app }) => {
    const project = unique("PortalLocal");
    await createInTree(app, "Novo projeto", project);
    const site = join(spaceDir(), project, "site");
    mkdirSync(site, { recursive: true });
    writeFileSync(
      join(site, "index.html"),
      '<!doctype html><link rel="stylesheet" href="estilo.css"><h1 id="titulo">LOGSTUDIO_PORTAL_LOCAL</h1>',
    );
    writeFileSync(join(site, "estilo.css"), "#titulo { color: rgb(255, 0, 0); }");
    writeFileSync(join(site, ".env"), "SEGREDO=1");
    await treeItem(app, project).click();

    // Ferramenta Portal: um clique cria a janela com a barra de endereço focada.
    await app.getByTitle("Portal", { exact: true }).click();
    const box = (await app.locator(".canvas").boundingBox())!;
    await app.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    const node = app.locator(".portal-node").last();
    const address = node.locator(".pt-address input");
    await expect(address).toBeFocused();
    await address.fill("site/index.html");
    await address.press("Enter");

    // A página carrega do servidor local, numa origem própria, com o CSS aplicado.
    const iframe = node.locator(".pt-frame");
    // A raiz servida é a pasta do HTML ("site"), então a URL termina em /index.html.
    await expect(iframe).toHaveAttribute("src", /^http:\/\/[0-9a-f]{32}\.localhost:\d+\/index\.html$/);
    const frame = node.frameLocator(".pt-frame");
    const title = frame.locator("#titulo");
    await expect(title).toHaveText("LOGSTUDIO_PORTAL_LOCAL", { timeout: 15_000 });
    await expect(title).toHaveCSS("color", "rgb(255, 0, 0)");

    // A página não consegue ler arquivos ocultos da pasta nem chamar o app. O WebView2 injeta
    // parte de `__TAURI_INTERNALS__` também no iframe, mas o Tauri recusa a chamada: a origem
    // do servidor local é remota e as capabilities só valem para as URLs locais do app.
    const probe = await title.evaluate(async () => {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string) => Promise<unknown> } };
      let invoke = "sem invoke";
      if (typeof w.__TAURI_INTERNALS__?.invoke === "function") {
        try {
          await Promise.race([
            w.__TAURI_INTERNALS__.invoke("get_settings"),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
          ]);
          invoke = "PERMITIDO";
        } catch (e) {
          invoke = String(e);
        }
      }
      return { env: (await fetch(".env")).status, invoke };
    });
    expect(probe.env).toBe(404);
    expect(probe.invoke).not.toBe("PERMITIDO");
    expect(probe.invoke).not.toContain("timeout");

    // A barra mostra o caminho do arquivo, não a URL interna.
    await expect(address).toHaveValue("site/index.html");
  });
});
