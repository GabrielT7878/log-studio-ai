//! Configurações do app, salvas em `<app_config_dir>/settings.json`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Diretório onde novas pastas e projetos são criados.
    pub projects_root: PathBuf,
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|e| format!("Pasta de configuração indisponível: {e}"))
}

/// Padrão: `~/LogStudio/Projetos` — ou `~/LogStudio/Projetos-dev` na versão de desenvolvimento
/// (identifier terminado em `.dev`), para ela não mexer nos projetos da versão instalada.
pub fn default_projects_root(app: &AppHandle) -> PathBuf {
    let dev = app.config().identifier.ends_with(".dev");
    app.path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("LogStudio")
        .join(if dev { "Projetos-dev" } else { "Projetos" })
}

/// Lê as configurações; usa o padrão se o arquivo não existir ou estiver inválido.
pub fn load(app: &AppHandle) -> Settings {
    settings_file(app)
        .ok()
        .and_then(|file| fs::read_to_string(file).ok())
        .and_then(|json| serde_json::from_str::<Settings>(&json).ok())
        .unwrap_or_else(|| Settings {
            projects_root: default_projects_root(app),
        })
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let file = settings_file(app)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Não foi possível criar a pasta de configuração: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&file, json).map_err(|e| format!("Não foi possível salvar as configurações: {e}"))
}
