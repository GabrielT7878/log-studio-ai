// Quadros (Excalidraw) do canvas: um arquivo `.excalidraw` (JSON padrão do Excalidraw)
// por quadro em `<projeto>/.logstudio/quadros/<id>.excalidraw`.

use std::fs;
use std::path::{Path, PathBuf};

type Res<T> = Result<T, String>;

/// Maior arquivo de quadro (imagens coladas no desenho vão dentro, em base64).
pub const MAX_BYTES: usize = 100 * 1024 * 1024;

pub fn dir(project: &Path) -> PathBuf {
    project.join(".logstudio").join("quadros")
}

/// Id do quadro (= id da janela): letras, números e "-", até 64.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn path(project: &Path, id: &str) -> Res<PathBuf> {
    if !valid_id(id) {
        return Err("Id de quadro inválido.".into());
    }
    Ok(dir(project).join(format!("{id}.excalidraw")))
}

/// Conteúdo salvo do quadro (None = ainda não existe arquivo, quadro vazio).
pub fn load(project: &Path, id: &str) -> Res<Option<String>> {
    let p = path(project, id)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(&p)
        .map(Some)
        .map_err(|e| format!("Não foi possível abrir o quadro: {e}"))
}

/// Salva o quadro (num temporário e troca, para não corromper o arquivo se algo falhar).
pub fn save(project: &Path, id: &str, content: &str) -> Res<()> {
    let p = path(project, id)?;
    if content.len() > MAX_BYTES {
        return Err("Quadro grande demais para salvar (máximo 100 MB).".into());
    }
    if !content.trim_start().starts_with('{') {
        return Err("Conteúdo de quadro inválido.".into());
    }
    let d = dir(project);
    fs::create_dir_all(&d).map_err(|e| format!("Não foi possível criar {}: {e}", d.display()))?;
    let tmp = p.with_extension("excalidraw.tmp");
    fs::write(&tmp, content).map_err(|e| format!("Não foi possível salvar o quadro: {e}"))?;
    fs::rename(&tmp, &p).map_err(|e| format!("Não foi possível salvar o quadro: {e}"))
}

/// Manda o arquivo do quadro para a Lixeira (sem erro se não existir).
pub fn remove(project: &Path, id: &str) -> Res<()> {
    let p = path(project, id)?;
    if !p.exists() {
        return Ok(());
    }
    trash::delete(&p).map_err(|e| format!("Não foi possível excluir o quadro: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_load_and_ids() {
        let project = std::env::temp_dir().join(format!("logstudio-boards-{}", std::process::id()));
        let _ = fs::remove_dir_all(&project);
        fs::create_dir_all(&project).unwrap();

        let id = "3f2a-9c";
        assert_eq!(load(&project, id).unwrap(), None);
        save(&project, id, r#"{"type":"excalidraw","elements":[]}"#).unwrap();
        assert!(load(&project, id).unwrap().unwrap().contains("excalidraw"));
        save(&project, id, r#"{"type":"excalidraw","elements":[1]}"#).unwrap();
        assert!(load(&project, id).unwrap().unwrap().contains("[1]"));
        assert!(save(&project, id, "não é json").is_err());

        for bad in ["", "../x", "a/b", "a.b", "a b"] {
            assert!(!valid_id(bad), "{bad}");
            assert!(load(&project, bad).is_err(), "{bad}");
        }
        let _ = fs::remove_dir_all(&project);
    }
}
