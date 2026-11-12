.PHONY: start

# Versão de desenvolvimento: identifier, dados, pasta de projetos e ícone próprios
# (src-tauri/tauri.dev.conf.json) — não interfere na versão instalada.
start:
	npm run tauri dev -- --config src-tauri/tauri.dev.conf.json
