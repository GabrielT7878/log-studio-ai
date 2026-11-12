.PHONY: start release

# Versão de desenvolvimento: identifier, dados, pasta de projetos e ícone próprios
# (src-tauri/tauri.dev.conf.json) — não interfere na versão instalada.
start:
	npm run tauri dev -- --config src-tauri/tauri.dev.conf.json

# Publica uma versão: make release V=0.1.1
# Atualiza package.json/Cargo.toml, faz commit, cria a tag vX e envia; o GitHub Actions
# (.github/workflows/release.yml) compila, assina e cria o release.
release:
	@test -n "$(V)" || (echo "Use: make release V=x.y.z" && exit 1)
	@test -z "$$(git status --porcelain)" || (echo "Há alterações sem commit; faça o commit antes." && exit 1)
	npm version $(V) --no-git-tag-version
	sed -i '0,/^version = ".*"/s//version = "$(V)"/' src-tauri/Cargo.toml
	cd src-tauri && cargo update -p log-studio-ai --offline
	git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock
	git commit -m "Versão $(V)"
	git tag v$(V)
	git push origin HEAD v$(V)
