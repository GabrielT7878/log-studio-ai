//! Espaços de trabalho (ex.: "Trabalho", "Pessoal").
//!
//! - Cada espaço é um subdiretório da raiz dos projetos, com a sua própria árvore
//!   (e o seu próprio `.logstudio.json`, gerenciado por `workspace.rs`).
//! - `<raiz>/.logstudio-workspaces.json` guarda a ordem e o último espaço aberto.
//! - Se esse arquivo não existe (layout antigo ou raiz nova), cria o espaço "Pessoal"
//!   e move para dentro dele o que estava solto na raiz — uma única vez.

use crate::workspace::{list_dirs, same_name, unique_name, validate_name, META_FILE};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const REGISTRY_FILE: &str = ".logstudio-workspaces.json";
const REGISTRY_VERSION: u32 = 1;
const DEFAULT_SPACE: &str = "Pessoal";

type Res<T> = Result<T, String>;

#[derive(Serialize, Deserialize, Default)]
struct Registry {
    #[serde(default)]
    version: u32,
    /// Ordem dos espaços.
    #[serde(default)]
    order: Vec<String>,
    /// Último espaço aberto.
    #[serde(default)]
    last: Option<String>,
}

/// Enviado ao frontend.
#[derive(Serialize)]
pub struct SpacesInfo {
    pub spaces: Vec<String>,
    pub current: String,
}

fn read_registry(root: &Path) -> Option<Registry> {
    let json = fs::read_to_string(root.join(REGISTRY_FILE)).ok()?;
    Some(serde_json::from_str(&json).unwrap_or_default())
}

fn write_registry(root: &Path, reg: &Registry) -> Res<()> {
    let json = serde_json::to_string_pretty(reg).map_err(|e| e.to_string())?;
    let tmp = root.join(format!("{REGISTRY_FILE}.tmp"));
    fs::write(&tmp, json).map_err(|e| format!("Não foi possível salvar {REGISTRY_FILE}: {e}"))?;
    fs::rename(&tmp, root.join(REGISTRY_FILE))
        .map_err(|e| format!("Não foi possível salvar {REGISTRY_FILE}: {e}"))
}

/// Garante o layout com espaços; na primeira vez, migra o conteúdo da raiz para "Pessoal".
fn ensure(root: &Path) -> Res<Registry> {
    fs::create_dir_all(root).map_err(|e| format!("Não foi possível criar {}: {e}", root.display()))?;
    if let Some(reg) = read_registry(root) {
        return Ok(reg);
    }

    let existing = list_dirs(root);
    let name = unique_name(root, DEFAULT_SPACE);
    let space_dir = root.join(&name);
    fs::create_dir(&space_dir).map_err(|e| format!("Não foi possível criar “{name}”: {e}"))?;

    // Registro primeiro: se algum diretório não puder ser movido, ele continua
    // na raiz e aparece como um espaço próprio (nada se perde, nada é duplicado).
    let reg = Registry {
        version: REGISTRY_VERSION,
        order: vec![name.clone()],
        last: Some(name),
    };
    write_registry(root, &reg)?;

    let old_meta = root.join(META_FILE);
    if old_meta.exists() {
        let _ = fs::rename(&old_meta, space_dir.join(META_FILE));
    }
    for dir in existing {
        let _ = fs::rename(root.join(&dir), space_dir.join(&dir));
    }
    Ok(reg)
}

/// Espaços existentes no disco, na ordem salva (novos no fim, em ordem alfabética).
fn list(root: &Path, reg: &Registry) -> Vec<String> {
    let mut dirs = list_dirs(root);
    let mut out = Vec::new();
    for name in &reg.order {
        if let Some(pos) = dirs.iter().position(|d| d == name) {
            out.push(dirs.remove(pos));
        }
    }
    dirs.sort_by_key(|d| d.to_lowercase());
    out.extend(dirs);
    out
}

/// Carrega (e normaliza) a lista de espaços e o atual.
pub fn info(root: &Path) -> Res<SpacesInfo> {
    let mut reg = ensure(root)?;
    let mut spaces = list(root, &reg);
    if spaces.is_empty() {
        fs::create_dir(root.join(DEFAULT_SPACE))
            .map_err(|e| format!("Não foi possível criar “{DEFAULT_SPACE}”: {e}"))?;
        spaces.push(DEFAULT_SPACE.to_string());
    }
    let current = reg
        .last
        .clone()
        .filter(|last| spaces.contains(last))
        .unwrap_or_else(|| spaces[0].clone());

    reg.version = REGISTRY_VERSION;
    reg.order = spaces.clone();
    reg.last = Some(current.clone());
    write_registry(root, &reg)?;
    Ok(SpacesInfo { spaces, current })
}

/// Diretório de um espaço existente.
pub fn dir_of(root: &Path, name: &str) -> Res<PathBuf> {
    let reg = ensure(root)?;
    if list(root, &reg).iter().any(|s| s == name) {
        Ok(root.join(name))
    } else {
        Err("Espaço de trabalho não encontrado.".into())
    }
}

pub fn create(root: &Path, raw_name: &str) -> Res<SpacesInfo> {
    let name = validate_name(raw_name)?;
    let mut reg = ensure(root)?;
    if list(root, &reg).iter().any(|s| same_name(s, &name)) || root.join(&name).exists() {
        return Err(format!("Já existe um espaço de trabalho chamado “{name}”."));
    }
    fs::create_dir(root.join(&name)).map_err(|e| format!("Não foi possível criar “{name}”: {e}"))?;
    reg.order.push(name.clone());
    reg.last = Some(name);
    write_registry(root, &reg)?;
    info(root)
}

pub fn select(root: &Path, name: &str) -> Res<()> {
    let mut reg = ensure(root)?;
    if !list(root, &reg).iter().any(|s| s == name) {
        return Err("Espaço de trabalho não encontrado.".into());
    }
    reg.last = Some(name.to_string());
    write_registry(root, &reg)
}

pub fn rename(root: &Path, old: &str, raw_new: &str) -> Res<SpacesInfo> {
    let new = validate_name(raw_new)?;
    let mut reg = ensure(root)?;
    let spaces = list(root, &reg);
    if !spaces.iter().any(|s| s == old) {
        return Err("Espaço de trabalho não encontrado.".into());
    }
    if old == new {
        return info(root);
    }
    if root.join(&new).exists() && !same_name(old, &new) {
        return Err(format!("Já existe um espaço de trabalho chamado “{new}”."));
    }
    fs::rename(root.join(old), root.join(&new)).map_err(|e| format!("Não foi possível renomear: {e}"))?;

    reg.order = spaces.into_iter().map(|s| if s == old { new.clone() } else { s }).collect();
    if reg.last.as_deref() == Some(old) {
        reg.last = Some(new);
    }
    write_registry(root, &reg)?;
    info(root)
}

/// Manda o espaço inteiro para a Lixeira (não permite excluir o último).
pub fn delete(root: &Path, name: &str) -> Res<SpacesInfo> {
    let mut reg = ensure(root)?;
    let spaces = list(root, &reg);
    if !spaces.iter().any(|s| s == name) {
        return Err("Espaço de trabalho não encontrado.".into());
    }
    if spaces.len() <= 1 {
        return Err("Não é possível excluir o único espaço de trabalho.".into());
    }
    crate::workspace::trash_dir(&root.join(name))?;

    reg.order.retain(|s| s != name);
    if reg.last.as_deref() == Some(name) {
        reg.last = None;
    }
    write_registry(root, &reg)?;
    info(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("logstudio-spaces-{tag}-{nanos}"))
    }

    #[test]
    fn migrates_old_layout_into_pessoal() {
        let root = temp_root("migrate");
        fs::create_dir_all(root.join("Projeto A")).unwrap();
        fs::create_dir_all(root.join("Pasta X").join("Projeto B")).unwrap();
        fs::write(root.join(META_FILE), "{}").unwrap();

        let info = info(&root).unwrap();
        assert_eq!(info.spaces, ["Pessoal"]);
        assert_eq!(info.current, "Pessoal");
        assert!(root.join("Pessoal").join("Projeto A").is_dir());
        assert!(root.join("Pessoal").join("Pasta X").join("Projeto B").is_dir());
        assert!(root.join("Pessoal").join(META_FILE).is_file());
        assert!(!root.join("Projeto A").exists());

        // Segunda carga não migra de novo.
        assert_eq!(super::info(&root).unwrap().spaces, ["Pessoal"]);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn create_select_rename() {
        let root = temp_root("crud");
        assert_eq!(info(&root).unwrap().spaces, ["Pessoal"]); // raiz nova

        let i = create(&root, "Trabalho").unwrap();
        assert_eq!(i.spaces, ["Pessoal", "Trabalho"]);
        assert_eq!(i.current, "Trabalho");
        assert!(create(&root, "trabalho").is_err()); // duplicado
        assert!(create(&root, "a/b").is_err()); // inválido

        select(&root, "Pessoal").unwrap();
        assert_eq!(info(&root).unwrap().current, "Pessoal");

        let i = rename(&root, "Pessoal", "Casa").unwrap();
        assert_eq!(i.spaces, ["Casa", "Trabalho"]);
        assert_eq!(i.current, "Casa");
        assert!(root.join("Casa").is_dir());
        assert_eq!(dir_of(&root, "Trabalho").unwrap(), root.join("Trabalho"));
        assert!(dir_of(&root, "Pessoal").is_err());

        fs::remove_dir_all(&root).ok();
    }
}
