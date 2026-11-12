// Imagens do canvas: arquivos em `<projeto>/.logstudio/imagens/`.
// O card guarda só o nome do arquivo; o caminho é sempre resolvido a partir do projeto,
// então renomear/mover o projeto não quebra as imagens.

use std::fs;
use std::path::{Path, PathBuf};

type Res<T> = Result<T, String>;

/// Tamanho máximo de uma imagem (colada ou importada).
pub const MAX_BYTES: usize = 50 * 1024 * 1024;

const EXTS: &[&str] = &["png", "jpg", "gif", "webp", "bmp"];

pub fn images_dir(project: &Path) -> PathBuf {
    project.join(".logstudio").join("imagens")
}

/// Extensões aceitas no arrastar do Explorer (o conteúdo é conferido depois).
pub fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"))
        .unwrap_or(false)
}

/// Descobre o formato pelos primeiros bytes (não confia na extensão).
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else {
        None
    }
}

/// Nome de arquivo aceito: `<letras/números/-/_>.<extensão conhecida>`, sem caminho.
pub fn valid_file(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem.len() <= 64
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && EXTS.contains(&ext)
}

/// Grava os bytes de uma imagem no projeto e devolve o nome do arquivo:
/// nome original simplificado + id (ex.: "Foto_praia-7f3a9c2e.jpg"; sem nome: "imagem-…").
/// A extensão vem do conteúdo, não do nome.
pub fn save(project: &Path, bytes: &[u8], original: Option<&str>) -> Res<String> {
    if bytes.len() > MAX_BYTES {
        return Err("Imagem grande demais (máximo 50 MB).".into());
    }
    let ext = sniff(bytes).ok_or("Formato de imagem não suportado (use PNG, JPG, GIF, WEBP ou BMP).")?;
    let dir = images_dir(project);
    fs::create_dir_all(&dir).map_err(|e| format!("Não foi possível criar {}: {e}", dir.display()))?;
    let name = crate::filename::unique_in(&dir, original.unwrap_or(""), "imagem", Some(ext));
    fs::write(dir.join(&name), bytes).map_err(|e| format!("Não foi possível salvar a imagem: {e}"))?;
    Ok(name)
}

/// Copia um arquivo de imagem (arrastado do Explorer) para o projeto.
pub fn import(project: &Path, src: &Path) -> Res<String> {
    let meta = fs::metadata(src).map_err(|e| format!("Não foi possível ler {}: {e}", src.display()))?;
    if !meta.is_file() {
        return Err("Não é um arquivo.".into());
    }
    if meta.len() as usize > MAX_BYTES {
        return Err("Imagem grande demais (máximo 50 MB).".into());
    }
    let bytes = fs::read(src).map_err(|e| format!("Não foi possível ler {}: {e}", src.display()))?;
    save(project, &bytes, src.file_name().and_then(|n| n.to_str()))
}

/// Lê uma imagem do projeto.
pub fn read(project: &Path, file: &str) -> Res<Vec<u8>> {
    if !valid_file(file) {
        return Err("Nome de imagem inválido.".into());
    }
    fs::read(images_dir(project).join(file)).map_err(|_| "Imagem não encontrada.".to_string())
}

/// Manda a imagem para a Lixeira (sem erro se ela já não existir).
pub fn remove(project: &Path, file: &str) -> Res<()> {
    if !valid_file(file) {
        return Err("Nome de imagem inválido.".into());
    }
    let path = images_dir(project).join(file);
    if !path.exists() {
        return Ok(());
    }
    trash::delete(&path).map_err(|e| format!("Não foi possível excluir a imagem: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("logstudio-img-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_read_import() {
        let project = temp_project("save");
        // Sem nome (colada): "imagem-<id>.png".
        let name = save(&project, PNG, None).unwrap();
        assert!(name.starts_with("imagem-") && name.ends_with(".png") && valid_file(&name), "{name}");
        assert_eq!(read(&project, &name).unwrap(), PNG);

        // Importar: nome original simplificado; a extensão vem do conteúdo, não do nome.
        let src = project.join("Foto da praia.jpg");
        fs::write(&src, PNG).unwrap();
        let imported = import(&project, &src).unwrap();
        assert!(imported.starts_with("Foto_da_praia-") && imported.ends_with(".png"), "{imported}");
        assert!(valid_file(&imported));

        assert!(save(&project, b"nao e imagem", None).is_err());
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn rejects_bad_names() {
        let project = temp_project("names");
        for bad in ["../x.png", "a/b.png", "a\\b.png", "x.exe", ".png", "x", "x.svg"] {
            assert!(!valid_file(bad), "{bad}");
            assert!(read(&project, bad).is_err(), "{bad}");
        }
        assert!(valid_file("img-1a2b-0.webp"));
        let _ = fs::remove_dir_all(&project);
    }
}
