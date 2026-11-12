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

## Licença

[MIT](LICENSE)
