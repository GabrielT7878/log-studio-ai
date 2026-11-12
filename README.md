# Log Studio AI

App desktop (Tauri + React) com um canvas infinito de janelas — notas, textos, terminais,
imagens, pastas, portais, anexos e quadros (Excalidraw) — organizado em espaços e projetos.
Terminais com Claude Code se conectam ao canvas por uma ponte MCP local e podem ler e
criar/alterar janelas e desenhar nos quadros.

## Instalação

Baixe o instalador (`.exe`) do [último release](../../releases/latest). O app verifica
novas versões sozinho e se atualiza depois de reiniciar.

## Desenvolvimento

Requisitos: Node.js, Rust e os [pré-requisitos do Tauri](https://tauri.app/start/prerequisites/).

```sh
npm install
make start
```

`make start` roda a **versão de desenvolvimento** ("Log Studio AI (Dev)", ícone com faixa
DEV). Ela tem identifier, configurações, dados e pasta de projetos padrão
(`~/LogStudio/Projetos-dev`) próprios, então pode rodar junto com a versão instalada sem
interferir nela.

## Testes

```sh
cd src-tauri && cargo test     # testes do Rust
npm run e2e:build              # build de testes do app ("Log Studio AI (E2E)")
npm run e2e                    # testes e2e (Playwright) contra o app de verdade
```

Os testes e2e (`e2e/`) abrem o build de testes com a porta CDP do WebView2 e uma pasta de
projetos temporária, e controlam a interface com o Playwright (`connectOverCDP`). Só rodam
no Windows. No GitHub Actions rodam a cada push/PR (`.github/workflows/e2e.yml`).

## Licença

[MIT](LICENSE)
