import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { closeSettings, expect, openSettings, test } from "./app";

const version = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8")).version as string;

test("aba Atualizações mostra a versão instalada e o changelog dos releases", async ({ app }) => {
  await openSettings(app);
  const modal = app.locator(".st-modal");
  await modal.getByRole("tab", { name: "Atualizações" }).click();
  await expect(modal.getByRole("tab", { name: "Atualizações" })).toHaveAttribute("aria-selected", "true");

  await expect(modal.getByText(`Log Studio AI ${version}`)).toBeVisible();
  // O build de testes não é a versão instalada: não verifica atualizações.
  await expect(modal.getByText("A atualização automática só funciona na versão instalada.")).toBeVisible();

  // Releases de e2e/releases.json: v99 é mais nova (Nova + Markdown); v0.0.1 é anterior.
  const novas = modal.getByRole("list", { name: "Novas versões" });
  await expect(novas.locator(".st-release-version")).toHaveText(["v99.0.0"]);
  await expect(novas.locator(".st-badge.new")).toHaveText("Nova");
  await expect(novas.locator(".st-release-body strong")).toHaveText("teste");
  const anteriores = modal.getByRole("list", { name: "Versões anteriores" });
  await expect(anteriores.locator(".st-release-version")).toHaveText(["v0.0.1"]);
  await expect(anteriores).toContainText("Primeira versão");

  // Voltar para Geral mostra as configurações de antes.
  await modal.getByRole("tab", { name: "Geral" }).click();
  await expect(modal.getByRole("button", { name: "Fazer backup agora" })).toBeVisible();
  await closeSettings(app);
});
