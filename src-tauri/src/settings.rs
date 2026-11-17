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
    /// Backup (campos opcionais: `None` = padrão). `default` mantém compatíveis
    /// os `settings.json` antigos, sem essa seção.
    #[serde(default)]
    pub backup: BackupSettings,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    /// Pasta dos backups escolhida pelo usuário.
    #[serde(default)]
    pub dir: Option<PathBuf>,
    /// Backup automático (de hora em hora e ao fechar).
    #[serde(default)]
    pub auto: Option<bool>,
    /// Último backup concluído (segundos desde 1970).
    #[serde(default)]
    pub last_backup_at: Option<i64>,
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|e| format!("Pasta de configuração indisponível: {e}"))
}

/// Marcador de backup em andamento, na pasta de configuração (sobrevive a trocar
/// a pasta de backups). Se existir ao abrir o app, o último backup foi interrompido.
pub fn backup_pending_file(app: &AppHandle) -> Result<PathBuf, String> {
    settings_file(app).map(|f| f.with_file_name(crate::backup::PENDING_FILE))
}

fn is_dev(app: &AppHandle) -> bool {
    app.config().identifier.ends_with(".dev")
}

/// Testes e2e: `LOGSTUDIO_PROJECTS_ROOT` definida.
fn is_e2e() -> bool {
    std::env::var_os("LOGSTUDIO_PROJECTS_ROOT").is_some_and(|r| !r.is_empty())
}

fn logstudio_home(app: &AppHandle) -> PathBuf {
    app.path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("LogStudio")
}

/// Padrão: `~/LogStudio/Projetos` — ou `~/LogStudio/Projetos-dev` na versão de desenvolvimento
/// (identifier terminado em `.dev`), para ela não mexer nos projetos da versão instalada.
pub fn default_projects_root(app: &AppHandle) -> PathBuf {
    logstudio_home(app).join(if is_dev(app) { "Projetos-dev" } else { "Projetos" })
}

/// Pasta dos backups: `LOGSTUDIO_BACKUP_DIR` (testes e2e) > escolha do usuário >
/// `~/LogStudio/Backups` (dev: `Backups-dev`).
pub fn backup_dir(app: &AppHandle, settings: &Settings) -> PathBuf {
    if let Some(dir) = std::env::var_os("LOGSTUDIO_BACKUP_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    settings
        .backup
        .dir
        .clone()
        .unwrap_or_else(|| logstudio_home(app).join(if is_dev(app) { "Backups-dev" } else { "Backups" }))
}

/// Backup automático: ligado por padrão, desligado por padrão nos testes e2e.
pub fn backup_auto(settings: &Settings) -> bool {
    settings.backup.auto.unwrap_or(!is_e2e())
}

/// Lê as configurações; usa o padrão se o arquivo não existir ou estiver inválido.
/// `LOGSTUDIO_PROJECTS_ROOT` (testes e2e) substitui a pasta de projetos.
pub fn load(app: &AppHandle) -> Settings {
    let mut settings = settings_file(app)
        .ok()
        .and_then(|file| fs::read_to_string(file).ok())
        .and_then(|json| serde_json::from_str::<Settings>(&json).ok())
        .unwrap_or_else(|| Settings {
            projects_root: default_projects_root(app),
            backup: BackupSettings::default(),
        });
    if let Some(root) = std::env::var_os("LOGSTUDIO_PROJECTS_ROOT").filter(|r| !r.is_empty()) {
        settings.projects_root = PathBuf::from(root);
    }
    settings
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let file = settings_file(app)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Não foi possível criar a pasta de configuração: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&file, json).map_err(|e| format!("Não foi possível salvar as configurações: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_without_backup_still_load() {
        let s: Settings = serde_json::from_str(r#"{"projectsRoot":"C:\\x"}"#).unwrap();
        assert!(s.backup.dir.is_none() && s.backup.auto.is_none() && s.backup.last_backup_at.is_none());
    }

    #[test]
    fn settings_with_old_exclusions_still_load() {
        let s: Settings =
            serde_json::from_str(r#"{"projectsRoot":"C:\\x","backup":{"auto":true,"exclusions":["node_modules"]}}"#)
                .unwrap();
        assert_eq!(s.backup.auto, Some(true));
    }
}
