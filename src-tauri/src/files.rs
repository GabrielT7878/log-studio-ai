// Navegador de arquivos do canvas ("Pasta"): listar, ler, salvar e buscar arquivos
// DENTRO do diretório do projeto. Todo caminho vem relativo ao projeto e é validado.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

type Res<T> = Result<T, String>;

/// Maior arquivo de texto aberto no editor.
pub const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
/// Maior arquivo lido como bytes (imagens).
pub const MAX_BYTES: u64 = 50 * 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 300;
const MAX_SEARCH_DEPTH: usize = 12;
/// Pastas ignoradas na busca (pesadas ou internas).
const SEARCH_SKIP: &[&str] = &[".git", "node_modules", "target", ".logstudio"];
/// Entradas escondidas na listagem.
const LIST_HIDE: &[&str] = &[".logstudio"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// Milissegundos desde 1970 (0 se indisponível).
    pub modified: u64,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TextFile {
    Text { content: String },
    Binary,
    TooLarge { size: u64 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// Caminho relativo ao projeto, com "/".
    pub path: String,
    pub is_dir: bool,
}

/// Caminho relativo ("a/b/c", "" = raiz) → absoluto dentro de `root`.
/// Recusa "..", caminhos absolutos e qualquer coisa que saia do projeto (inclusive por link).
pub fn resolve(root: &Path, rel: &str) -> Res<PathBuf> {
    let rel = rel.trim_matches(|c| c == '/' || c == '\\');
    let mut path = root.to_path_buf();
    if !rel.is_empty() {
        for comp in Path::new(rel).components() {
            match comp {
                Component::Normal(part) => path.push(part),
                Component::CurDir => {}
                _ => return Err("Caminho inválido.".into()),
            }
        }
    }
    // Se existir, confere o caminho real (links simbólicos não podem escapar do projeto).
    if path.exists() {
        let real_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        let real = fs::canonicalize(&path).map_err(|e| e.to_string())?;
        if !real.starts_with(&real_root) {
            return Err("Caminho fora do projeto.".into());
        }
    }
    Ok(path)
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Conteúdo de uma pasta do projeto (pastas primeiro, depois por nome).
pub fn list(root: &Path, rel: &str) -> Res<Vec<Entry>> {
    let dir = resolve(root, rel)?;
    let read = fs::read_dir(&dir).map_err(|e| format!("Não foi possível abrir a pasta: {e}"))?;
    let mut out: Vec<Entry> = read
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            if LIST_HIDE.contains(&name.as_str()) {
                return None;
            }
            let meta = e.metadata().ok()?;
            Some(Entry {
                name,
                is_dir: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
                modified: modified_ms(&meta),
            })
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// Lê um arquivo de texto (UTF-8). Binário ou grande demais → avisa em vez do conteúdo.
pub fn read_text(root: &Path, rel: &str) -> Res<TextFile> {
    let path = resolve(root, rel)?;
    let meta = fs::metadata(&path).map_err(|e| format!("Não foi possível abrir o arquivo: {e}"))?;
    if !meta.is_file() {
        return Err("Não é um arquivo.".into());
    }
    if meta.len() > MAX_TEXT_BYTES {
        return Ok(TextFile::TooLarge { size: meta.len() });
    }
    let bytes = fs::read(&path).map_err(|e| format!("Não foi possível ler o arquivo: {e}"))?;
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return Ok(TextFile::Binary);
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(TextFile::Text { content }),
        Err(_) => Ok(TextFile::Binary),
    }
}

/// Bytes de um arquivo (para mostrar imagens).
pub fn read_bytes(root: &Path, rel: &str) -> Res<Vec<u8>> {
    let path = resolve(root, rel)?;
    let meta = fs::metadata(&path).map_err(|e| format!("Não foi possível abrir o arquivo: {e}"))?;
    if !meta.is_file() {
        return Err("Não é um arquivo.".into());
    }
    if meta.len() > MAX_BYTES {
        return Err("Arquivo grande demais para mostrar.".into());
    }
    fs::read(&path).map_err(|e| format!("Não foi possível ler o arquivo: {e}"))
}

/// Salva um arquivo de texto existente.
pub fn write_text(root: &Path, rel: &str, content: &str) -> Res<()> {
    let path = resolve(root, rel)?;
    if !path.is_file() {
        return Err("O arquivo não existe mais.".into());
    }
    fs::write(&path, content).map_err(|e| format!("Não foi possível salvar: {e}"))
}

/// Cria um arquivo vazio ou uma pasta dentro de `dir` e devolve o caminho relativo.
/// Nunca sobrescreve: se o nome já existir, dá erro.
pub fn create(root: &Path, dir: &str, raw_name: &str, is_dir: bool) -> Res<String> {
    let name = crate::workspace::validate_name(raw_name)?;
    let parent = resolve(root, dir)?;
    if !parent.is_dir() {
        return Err("A pasta não existe mais.".into());
    }
    let path = parent.join(&name);
    if path.exists() {
        return Err(format!("Já existe um item chamado \"{name}\"."));
    }
    if is_dir {
        fs::create_dir(&path).map_err(|e| format!("Não foi possível criar a pasta: {e}"))?;
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| format!("Não foi possível criar o arquivo: {e}"))?;
    }
    let dir = dir.trim_matches(|c| c == '/' || c == '\\');
    Ok(if dir.is_empty() { name } else { format!("{dir}/{name}") })
}

/// Move um arquivo/pasta para dentro de `to_dir` e devolve o novo caminho relativo.
/// Não sobrescreve, não move uma pasta para dentro dela mesma e não sai do projeto.
pub fn move_item(root: &Path, from: &str, to_dir: &str) -> Res<String> {
    let from_rel = from.trim_matches(|c| c == '/' || c == '\\');
    if from_rel.is_empty() {
        return Err("Não dá para mover a raiz do projeto.".into());
    }
    let src = resolve(root, from_rel)?;
    if !src.exists() {
        return Err("O item não existe mais.".into());
    }
    let dst_dir = resolve(root, to_dir)?;
    if !dst_dir.is_dir() {
        return Err("A pasta de destino não existe.".into());
    }
    let real_src = fs::canonicalize(&src).map_err(|e| e.to_string())?;
    let real_dst = fs::canonicalize(&dst_dir).map_err(|e| e.to_string())?;
    if real_dst.starts_with(&real_src) {
        return Err("Não dá para mover uma pasta para dentro dela mesma.".into());
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nome inválido.")?
        .to_string();
    // Já está nessa pasta: nada a fazer.
    if real_src.parent() == Some(real_dst.as_path()) {
        return Ok(from_rel.to_string());
    }
    let dst = dst_dir.join(&name);
    if dst.exists() {
        return Err(format!("Já existe um item chamado \"{name}\" no destino."));
    }
    fs::rename(&src, &dst).map_err(|e| format!("Não foi possível mover: {e}"))?;
    let to = to_dir.trim_matches(|c| c == '/' || c == '\\');
    Ok(if to.is_empty() { name } else { format!("{to}/{name}") })
}

/// Busca por nome (sem diferenciar maiúsculas) em todas as subpastas do projeto.
pub fn search(root: &Path, query: &str) -> Res<Vec<SearchHit>> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let mut hits = Vec::new();
    let mut stack: Vec<(PathBuf, String, usize)> = vec![(root.to_path_buf(), String::new(), 0)];
    while let Some((dir, prefix, depth)) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = read.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let Ok(name) = e.file_name().into_string() else { continue };
            let Ok(ft) = e.file_type() else { continue };
            let is_dir = ft.is_dir(); // links simbólicos não são seguidos
            if is_dir && SEARCH_SKIP.contains(&name.as_str()) {
                continue;
            }
            let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if name.to_lowercase().contains(&q) {
                hits.push(SearchHit { path: path.clone(), is_dir });
                if hits.len() >= MAX_SEARCH_RESULTS {
                    return Ok(hits);
                }
            }
            if is_dir && depth < MAX_SEARCH_DEPTH {
                stack.push((e.path(), path, depth + 1));
            }
        }
    }
    hits.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("logstudio-files-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src/sub")).unwrap();
        fs::create_dir_all(dir.join(".logstudio/imagens")).unwrap();
        fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        fs::write(dir.join("README.md"), "# Olá").unwrap();
        fs::write(dir.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(dir.join("src/sub/main_test.rs"), "x").unwrap();
        fs::write(dir.join("node_modules/pkg/main.js"), "x").unwrap();
        fs::write(dir.join("bin.dat"), [0u8, 1, 2, 3]).unwrap();
        dir
    }

    #[test]
    fn blocks_paths_outside_project() {
        let root = temp_root("resolve");
        for bad in ["..", "../x", "src/../../x", "C:/Windows", "C:\\Windows"] {
            assert!(resolve(&root, bad).is_err(), "{bad}");
        }
        // Barras no começo são ignoradas: o caminho continua dentro do projeto.
        assert_eq!(resolve(&root, "/etc").unwrap(), root.join("etc"));
        assert_eq!(resolve(&root, "\\\\server\\x").unwrap(), root.join("server").join("x"));
        assert!(resolve(&root, "src/sub").is_ok());
        assert!(resolve(&root, "").is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_read_write_search() {
        let root = temp_root("ops");
        let names: Vec<String> = list(&root, "").unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names[0], "node_modules"); // pastas primeiro
        assert!(names.contains(&"README.md".to_string()));
        assert!(!names.contains(&".logstudio".to_string()));

        assert!(matches!(read_text(&root, "README.md").unwrap(), TextFile::Text { content } if content == "# Olá"));
        assert!(matches!(read_text(&root, "bin.dat").unwrap(), TextFile::Binary));

        write_text(&root, "src/main.rs", "fn main() { println!(); }").unwrap();
        assert!(matches!(read_text(&root, "src/main.rs").unwrap(), TextFile::Text { content } if content.contains("println")));
        assert!(write_text(&root, "src/novo.rs", "x").is_err()); // só arquivos existentes

        assert_eq!(create(&root, "src", "novo.rs", false).unwrap(), "src/novo.rs");
        assert!(root.join("src/novo.rs").is_file());
        assert_eq!(create(&root, "", "docs", true).unwrap(), "docs");
        assert!(root.join("docs").is_dir());
        assert!(create(&root, "src", "novo.rs", false).is_err()); // não sobrescreve
        assert!(create(&root, "src", "a:b", false).is_err()); // nome inválido
        assert!(create(&root, "..", "x", true).is_err()); // fora do projeto

        // Mover
        assert_eq!(move_item(&root, "README.md", "docs").unwrap(), "docs/README.md");
        assert!(root.join("docs/README.md").is_file());
        assert_eq!(move_item(&root, "docs", "src").unwrap(), "src/docs");
        assert!(move_item(&root, "src", "src/docs").is_err()); // para dentro dela mesma
        assert!(move_item(&root, "src", "src").is_err());
        assert_eq!(move_item(&root, "src/novo.rs", "src").unwrap(), "src/novo.rs"); // mesma pasta
        fs::write(root.join("novo.rs"), "x").unwrap();
        assert!(move_item(&root, "novo.rs", "src").is_err()); // não sobrescreve
        assert!(move_item(&root, "", "src").is_err());
        assert!(move_item(&root, "novo.rs", "..").is_err());

        let hits: Vec<String> = search(&root, "MAIN").unwrap().into_iter().map(|h| h.path).collect();
        assert_eq!(hits, vec!["src/main.rs", "src/sub/main_test.rs"]); // node_modules ignorado
        let _ = fs::remove_dir_all(&root);
    }
}
