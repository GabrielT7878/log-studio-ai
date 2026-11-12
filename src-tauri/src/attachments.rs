// Anexos do canvas: qualquer arquivo copiado para `<projeto>/.logstudio/anexos/`.
// O card guarda o nome salvo (gerado) e o nome original; o caminho é sempre resolvido
// a partir do projeto, então renomear/mover o projeto não quebra os anexos.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

type Res<T> = Result<T, String>;

/// Maior anexo aceito.
pub const MAX_BYTES: u64 = 200 * 1024 * 1024;

/// Extensões que executam algo ao abrir: o app nunca abre esses arquivos (só mostra no Explorer).
const DANGEROUS: &[&str] = &[
    "exe", "msi", "msp", "bat", "cmd", "com", "scr", "pif", "ps1", "psm1", "vbs", "vbe", "js", "jse",
    "wsf", "wsh", "hta", "lnk", "reg", "jar", "cpl", "msc", "appref-ms", "application", "gadget", "inf",
    "scf", "url",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attached {
    /// Nome do arquivo salvo em anexos/ (gerado).
    pub file: String,
    /// Nome original (mostrado no card).
    pub name: String,
    pub size: u64,
}

pub fn dir(project: &Path) -> PathBuf {
    project.join(".logstudio").join("anexos")
}

/// Extensão segura para o nome salvo (só letras/números, até 10, minúscula).
fn safe_ext(name: &str) -> Option<String> {
    let (_, ext) = name.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    (!ext.is_empty() && ext.len() <= 10 && ext.chars().all(|c| c.is_ascii_alphanumeric())).then_some(ext)
}

/// Nome salvo aceito: `<letras/números/-/_>[.ext]`, sem caminho.
pub fn valid_file(name: &str) -> bool {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s, Some(e)),
        None => (name, None),
    };
    !stem.is_empty()
        && stem.len() <= 64
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && ext.is_none_or(|e| !e.is_empty() && e.len() <= 10 && e.chars().all(|c| c.is_ascii_alphanumeric()))
}

pub fn is_dangerous(name: &str) -> bool {
    safe_ext(name).is_some_and(|e| DANGEROUS.contains(&e.as_str()))
}

/// Nome salvo: nome original simplificado + id (ex.: "Relatorio_Final_1-7f3a9c2e.pdf").
fn new_name(dir: &Path, original: &str) -> String {
    crate::filename::unique_in(dir, original, "anexo", safe_ext(original).as_deref())
}

/// Nome original limpo (sem caminho, tamanho limitado).
fn clean_original(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).trim();
    let base: String = base.chars().filter(|c| !c.is_control()).take(200).collect();
    if base.is_empty() { "arquivo".into() } else { base }
}

fn too_big() -> String {
    "Arquivo grande demais (máximo 200 MB).".into()
}

/// Copia um arquivo (arrastado do Explorer ou escolhido no seletor) para os anexos do projeto.
pub fn import(project: &Path, src: &Path) -> Res<Attached> {
    let meta = fs::metadata(src).map_err(|e| format!("Não foi possível ler {}: {e}", src.display()))?;
    if !meta.is_file() {
        return Err(format!("\"{}\" não é um arquivo (pastas não podem ser anexadas).", src.display()));
    }
    if meta.len() > MAX_BYTES {
        return Err(too_big());
    }
    let name = clean_original(&src.to_string_lossy());
    let target = dir(project);
    fs::create_dir_all(&target).map_err(|e| format!("Não foi possível criar {}: {e}", target.display()))?;
    let file = new_name(&target, &name);
    fs::copy(src, target.join(&file)).map_err(|e| format!("Não foi possível copiar o arquivo: {e}"))?;
    Ok(Attached { file, name, size: meta.len() })
}

/// Grava bytes recebidos (Ctrl+V de arquivo copiado) nos anexos do projeto.
pub fn save(project: &Path, original_name: &str, bytes: &[u8]) -> Res<Attached> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(too_big());
    }
    let name = clean_original(original_name);
    let target = dir(project);
    fs::create_dir_all(&target).map_err(|e| format!("Não foi possível criar {}: {e}", target.display()))?;
    let file = new_name(&target, &name);
    fs::write(target.join(&file), bytes).map_err(|e| format!("Não foi possível salvar o arquivo: {e}"))?;
    Ok(Attached { file, name, size: bytes.len() as u64 })
}

/// Caminho absoluto de um anexo existente.
pub fn path(project: &Path, file: &str) -> Res<PathBuf> {
    if !valid_file(file) {
        return Err("Nome de anexo inválido.".into());
    }
    let p = dir(project).join(file);
    if !p.is_file() {
        return Err("Anexo não encontrado.".into());
    }
    Ok(p)
}

/// Manda o anexo para a Lixeira (sem erro se ele já não existir).
pub fn remove(project: &Path, file: &str) -> Res<()> {
    if !valid_file(file) {
        return Err("Nome de anexo inválido.".into());
    }
    let p = dir(project).join(file);
    if !p.exists() {
        return Ok(());
    }
    trash::delete(&p).map_err(|e| format!("Não foi possível excluir o anexo: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("logstudio-anx-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn import_save_and_paths() {
        let project = temp_project("ops");
        let src = project.join("Relatório Final.PDF");
        fs::write(&src, b"%PDF-1.4").unwrap();

        let a = import(&project, &src).unwrap();
        assert_eq!(a.name, "Relatório Final.PDF");
        assert_eq!(a.size, 8);
        assert!(a.file.starts_with("Relatorio_Final-") && a.file.ends_with(".pdf") && valid_file(&a.file), "{}", a.file);
        assert!(path(&project, &a.file).unwrap().is_file());

        let b = save(&project, "C:\\pasta\\notas.txt", b"oi").unwrap();
        assert_eq!(b.name, "notas.txt");
        assert!(b.file.ends_with(".txt"));

        let c = save(&project, "SEMEXT", b"x").unwrap();
        assert!(!c.file.contains('.') && valid_file(&c.file));

        assert!(import(&project, &project).is_err()); // pasta não
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn names_and_danger() {
        for bad in ["../x.pdf", "a/b.pdf", "a\\b.pdf", ".pdf", "x.p df", ""] {
            assert!(!valid_file(bad), "{bad}");
        }
        assert!(valid_file("anx-1a-0.pdf"));
        assert!(is_dangerous("anx-1-0.EXE"));
        assert!(is_dangerous("setup.ps1"));
        assert!(!is_dangerous("anx-1-0.pdf"));
        assert!(!is_dangerous("README"));
    }
}
