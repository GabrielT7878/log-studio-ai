# AGENTS.md — Log Studio AI

Guia para agentes de IA (Claude Code, Codex etc.) que trabalham neste repositório.

## O que é

App desktop **Tauri 2 + React 19 + TypeScript (Vite)** com backend em **Rust**. Mostra um
canvas infinito de "janelas" (notas, textos, terminais, imagens, pastas, portais, anexos,
quadros Excalidraw) por projeto. Projetos ficam em pastas reais no disco, organizados em
espaços de trabalho. Terminais com Claude Code se ligam ao canvas por uma ponte MCP local
e podem ler/criar/alterar janelas e desenhar nos quadros.

Plataforma-alvo: **Windows** (ConPTY, WebView2). Idioma do produto, da UI, dos comentários
e das mensagens de erro: **português (pt-BR)**.

## Comandos

```sh
npm install
make start                      # versão de DEV (ver "Dev x instalado")
npx tsc --noEmit -p .           # checagem de tipos do frontend
cd src-tauri && cargo test      # testes do Rust
npm run e2e:build               # build de testes do app (identifier .e2e)
npm run e2e                     # testes e2e (Playwright via CDP), só Windows
make release V=x.y.z            # publica versão (exige árvore git limpa)
```

Antes de dar uma tarefa por concluída: `tsc` sem erros, `cargo test` passando e, se mexeu em
fluxo de UI coberto por e2e (ou corrigiu um bug de UI), `npm run e2e:build && npm run e2e`.

## Estrutura

```
src/                       Frontend (React)
  App.tsx                  Layout: Sidebar + Canvas + modais + aviso de atualização
  components/              Um componente por arquivo (PascalCase.tsx)
    Canvas.tsx             Canvas: janelas, ferramentas, seleção, grupos, ações do agente
    Sidebar.tsx            Espaços + árvore de pastas/projetos
    *Node.tsx              Uma janela do canvas por tipo (NoteNode, TerminalNode, BoardNode…)
    ExcalidrawBoard.tsx    Quadro Excalidraw + funções puras de edição de cena (setas etc.)
  hooks/                   Estado e efeitos (useXxx.ts)
    useCanvasNodes.ts      Janelas do projeto aberto: cache por projeto + salvamento com debounce
    useWorkspaceTree.ts    Árvore do espaço (a fonte de verdade é o backend)
    useSpaces.ts           Espaços de trabalho
    useUpdater.ts          Atualização automática (só na versão instalada)
  lib/                     Lógica sem React
    api.ts                 TODAS as chamadas ao backend (invoke dos comandos Tauri)
    agentTools.ts          Implementação das ferramentas MCP do agente no canvas
    canvasNodes.ts         Tipos e validação (sanitize) das janelas salvas
    terminals.ts           Registro dos terminais (xterm.js ↔ PTY do backend)
    boardScenes.ts         Cenas dos quadros (arquivo .excalidraw por quadro)
  App.css                  Estilos globais (tokens em :root; classes por componente)

src-tauri/                 Backend (Rust)
  src/lib.rs               Registro de plugins, estado e TODOS os #[tauri::command]
  src/workspace.rs         Árvore de pastas/projetos + `.logstudio.json` do espaço
  src/spaces.rs            Espaços de trabalho (`.logstudio-workspaces.json` na raiz)
  src/settings.rs          Configurações (`<app_config_dir>/settings.json`)
  src/pty.rs               Terminais reais (ConPTY) — guarda o cwd de cada sessão
  src/agent_bridge.rs      Servidor MCP local (127.0.0.1) + definição das ferramentas do agente
  src/files.rs, images.rs, attachments.rs, boards.rs, portal.rs, fetch.rs, usage.rs …
  tauri.conf.json          Config da versão PUBLICADA (identifier com.logstudio.ai)
  tauri.dev.conf.json      Sobrescreve para DEV (identifier .dev, ícone com faixa DEV)
  tauri.e2e.conf.json      Sobrescreve para os testes e2e (identifier .e2e)

e2e/                       Testes e2e (Playwright conectado ao WebView2 via CDP)
.github/workflows/         release.yml (tag v* → release assinado) e e2e.yml (push/PR)
```

## Onde ficam os dados (no disco do usuário)

- Raiz de projetos: `~/LogStudio/Projetos` (dev: `~/LogStudio/Projetos-dev`; e2e: pasta
  temporária via `LOGSTUDIO_PROJECTS_ROOT`).
- `<raiz>/.logstudio-workspaces.json`: ordem dos espaços e o último aberto.
- `<raiz>/<espaço>/.logstudio.json`: árvore do espaço (ordem, cores, expandido, projeto
  aberto) **e as janelas (`canvas`) e a vista (`view`) de cada projeto**.
- `<projeto>/.logstudio/{imagens,anexos,quadros}/`: arquivos das janelas.

Os ids de pastas/projetos são **caminhos** (`"Pasta/Projeto"`). Renomear ou mover muda o id.

## Padrões e regras do projeto

**Segurança e caminhos**
- O backend nunca aceita caminho absoluto vindo do frontend para operar em arquivos: recebe
  `space` + `id` do projeto + caminho relativo, resolve com `workspace::path_of`/`spaces::dir_of`
  e valida que o resultado fica dentro do projeto (ver `files.rs`).
- A ponte MCP só escuta em `127.0.0.1` e exige o token Bearer de cada terminal.
- Exclusões vão para a **Lixeira** (`trash`), nunca apagam direto. Pastas: use
  `workspace::trash_dir` (encerra antes os terminais com `pty.kill_under`, tenta de novo e
  dá erro claro se outro programa estiver usando a pasta).

**Backend (Rust)**
- Comandos Tauri ficam em `lib.rs`; a lógica fica no módulo do assunto. Erros são
  `Result<T, String>` com mensagem em pt-BR pronta para mostrar ao usuário.
- `AppState.settings` (Mutex) serializa operações no disco: use `with_root`/`with_space`.
- Testes unitários no próprio módulo (`#[cfg(test)]`), usando pastas em `std::env::temp_dir()`.

**Frontend (React)**
- Toda chamada ao backend passa por `src/lib/api.ts`.
- Janelas do canvas: tipos e validação em `canvasNodes.ts` (todo dado lido do disco passa
  por `sanitizeNodes`). Alterações via `update(fn)` do `useCanvasNodes` (salva com debounce).
- **Antes de renomear/mover/excluir espaço, pasta ou projeto, chame `await flushCanvas()`**
  (o caminho antigo deixa de existir e o salvamento pendente se perderia).
- A Sidebar só repassa o projeto aberto ao canvas quando a árvore carregada é do espaço
  atual (`treeSpace === spaces.current`). Não use dados de uma árvore de outro espaço.
- Estilos em `App.css` com as variáveis de `:root` (`--bg-*`, `--text*`, `--accent`).
  Ícones: `lucide-react`. Modais com `usePresence` (animação de saída).
- Textos visíveis e `title`s em pt-BR; os testes e2e usam esses textos como seletores —
  ao renomear um rótulo, atualize `e2e/`.

**Ferramentas do agente (MCP)** — para adicionar ou mudar uma ferramenta:
1. Definição (nome, descrição, `inputSchema`) em `tools()` de `src-tauri/src/agent_bridge.rs`.
   A descrição é o que o agente lê: seja preciso sobre ids, coordenadas e efeitos.
2. Implementação no `switch` de `src/lib/agentTools.ts` (valide os argumentos e lance
   `ToolError` com mensagem útil; devolva `result`, `log`, `touched` e `revert` quando
   a ação puder ser desfeita).
3. Se precisar do canvas/quadro, exponha a operação nas `deps` montadas em `Canvas.tsx`.
4. Quadros: funções puras em `ExcalidrawBoard.tsx` (ex.: `addElements`, `moveElements`).

## Dev x versão instalada

- `make start` roda a versão de dev com `tauri.dev.conf.json`: identifier
  `com.logstudio.ai.dev`, dados/WebView/configurações próprios, pasta `Projetos-dev` e ícone
  com faixa DEV. Ela pode rodar junto com a versão instalada sem interferir.
- **Nunca** rode um build com o identifier de produção (`com.logstudio.ai`) para testar:
  ele usaria os dados reais do usuário. Para testes automatizados use o build e2e.
- O updater só roda quando o identifier é exatamente `com.logstudio.ai`.

## Testes e2e

- `e2e/global-setup.ts` abre `src-tauri/target/debug/log-studio-ai.exe` (gerado por
  `npm run e2e:build`) com uma raiz de projetos temporária; os testes conectam com
  `chromium.connectOverCDP` na porta 9333. A porta vem de `additionalBrowserArgs` em
  `tauri.e2e.conf.json` (no runner do GitHub o WebView2 ignora a variável
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`). Nunca ponha essa porta nas outras configs.
- Use os helpers de `e2e/app.ts` (`createInTree`, `deleteInTree`, `openShellTerminal`,
  `treeItem`, `spaceDir`, `unique`). Nomes únicos por teste: o app é compartilhado.
- Ao corrigir um bug de UI, escreva o teste primeiro e confirme que ele **falha** sem a
  correção.
- Em falha, `test-results/` traz `falha.png` e `trace.zip` (`npx playwright show-trace`).

## Release

- Versão única em `package.json` (o `tauri.conf.json` lê de lá) e `src-tauri/Cargo.toml`.
- `make release V=x.y.z` atualiza as duas, faz commit, cria a tag `vX` e envia; o workflow
  `release.yml` compila, **assina** (secret `TAURI_SIGNING_PRIVATE_KEY`) e publica o
  instalador NSIS, o `.sig` e o `latest.json` que o updater do app lê.
- Nunca versionar chaves (`*.key`); a chave pública fica em `tauri.conf.json`.

## Commits

- Mensagens em pt-BR, no imperativo/descritivas, com corpo explicando o porquê quando útil.
- Não fazer commit/push/release sem o usuário pedir.
