//! Backup da raiz dos projetos inteira (todos os espaços) num `.zip`.
//!
//! - O zip é escrito como `<nome>.zip.tmp` e só vira `.zip` no fim: um backup
//!   interrompido (queda de energia, app encerrado à força) nunca parece válido.
//! - `backup-manifest.json` vai por último dentro do zip (data, espaços, contagens).
//! - Pastas excluídas por nome (`node_modules`, `target`…) e arquivos `*.tmp` ficam de fora.
//! - Retenção em camadas: o mais novo de cada uma das últimas 24 horas, 7 dias e
//!   4 semanas que têm backup; o resto vai para a Lixeira.
//! - Restaurar extrai sempre numa pasta NOVA ao lado da raiz (nunca sobrescreve).

use chrono::{Datelike, Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

type Res<T> = Result<T, String>;

pub const MANIFEST_FILE: &str = "backup-manifest.json";
pub const PENDING_FILE: &str = "backup.pending";
const MANIFEST_VERSION: u32 = 1;
const PREFIX: &str = "LogStudio-backup-";
const TMP_EXT: &str = ".zip.tmp";

const KEEP_HOURS: usize = 24;
const KEEP_DAYS: usize = 7;
const KEEP_WEEKS: usize = 4;

/// Exclusões padrão: nomes de pastas/arquivos, ou `*.ext` para terminações.
pub fn default_exclusions() -> Vec<String> {
    ["node_modules", "target", "dist", ".git", "*.tmp"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub app_version: String,
    /// Segundos desde 1970 (UTC).
    pub created_at: i64,
    pub spaces: Vec<String>,
    pub files: u64,
    pub bytes: u64,
    /// Arquivos que não puderam ser lidos (ex.: travados por outro programa).
    #[serde(default)]
    pub skipped: Vec<String>,
}

/// Um backup encontrado na pasta de destino (enviado ao frontend).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file: String,
    pub size: u64,
    pub created_at: i64,
    pub spaces: Vec<String>,
    pub files: u64,
    pub skipped: Vec<String>,
}

#[derive(Serialize, Clone, Copy, Debug)]
pub struct Progress {
    pub done: u64,
    pub total: u64,
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn excluded(name: &str, exclusions: &[String]) -> bool {
    let name = name.to_lowercase();
    exclusions.iter().any(|pat| {
        let pat = pat.trim().to_lowercase();
        match pat.strip_prefix('*') {
            Some(suffix) if !suffix.is_empty() => name.ends_with(suffix),
            _ => !pat.is_empty() && name == pat,
        }
    })
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Entradas da raiz que entram no backup (pastas e arquivos), sem a própria raiz.
/// Ignora exclusões, links simbólicos e a pasta de backups (se estiver dentro da raiz).
fn collect(root: &Path, dest: &Path, exclusions: &[String]) -> Res<Vec<walkdir::DirEntry>> {
    let mut out = Vec::new();
    let walker = WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
        e.depth() == 0
            || (!excluded(&e.file_name().to_string_lossy(), exclusions)
                && !(e.file_type().is_dir() && same_path(e.path(), dest)))
    });
    for entry in walker {
        let entry = entry.map_err(|e| format!("Não foi possível ler {}: {e}", root.display()))?;
        if entry.depth() == 0 || entry.file_type().is_symlink() {
            continue;
        }
        out.push(entry);
    }
    Ok(out)
}

/// Caminho dentro do zip: relativo à raiz, com `/`.
fn zip_name(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// Nome livre para um backup criado em `ts` (segundos), sem colidir com outro em `dest`.
fn file_name_for(dest: &Path, ts: i64) -> String {
    let stamp = Local
        .timestamp_opt(ts, 0)
        .single()
        .map(|d| d.format("%Y-%m-%d_%H%M%S").to_string())
        .unwrap_or_else(|| ts.to_string());
    let mut name = format!("{PREFIX}{stamp}.zip");
    let mut n = 2;
    while dest.join(&name).exists() || dest.join(format!("{name}.tmp")).exists() {
        name = format!("{PREFIX}{stamp}-{n}.zip");
        n += 1;
    }
    name
}

/// Cria o backup de `root` em `dest`. Devolve o backup criado.
/// `progress` é chamado durante a cópia; `cancel` interrompe (fica o `.zip.tmp`,
/// que `stale_tmps` encontra depois).
pub fn create(
    root: &Path,
    dest: &Path,
    exclusions: &[String],
    app_version: &str,
    cancel: &AtomicBool,
    mut progress: impl FnMut(Progress),
) -> Res<BackupInfo> {
    if !root.is_dir() {
        return Err(format!("A pasta de projetos não existe: {}", root.display()));
    }
    fs::create_dir_all(dest).map_err(|e| format!("Não foi possível criar a pasta de backups: {e}"))?;

    let entries = collect(root, dest, exclusions)?;
    let total = entries.iter().filter(|e| e.file_type().is_file()).count() as u64;
    let created_at = now_secs();
    let name = file_name_for(dest, created_at);
    let tmp = dest.join(format!("{name}.tmp"));

    let file = File::create(&tmp).map_err(|e| format!("Não foi possível criar o backup: {e}"))?;
    let mut zip = ZipWriter::new(BufWriter::new(file));
    let opts = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(true);
    let werr = |e: &dyn std::fmt::Display| format!("Erro ao escrever o backup: {e}");

    let (mut done, mut bytes) = (0u64, 0u64);
    let mut skipped = Vec::new();
    progress(Progress { done, total });
    for entry in &entries {
        if cancel.load(Ordering::Relaxed) {
            return Err("Backup cancelado.".into());
        }
        let Some(rel) = zip_name(root, entry.path()) else { continue };
        if entry.file_type().is_dir() {
            zip.add_directory(rel, opts).map_err(|e| werr(&e))?;
            continue;
        }
        done += 1;
        match File::open(entry.path()) {
            Ok(mut src) => {
                zip.start_file(rel, opts).map_err(|e| werr(&e))?;
                bytes += io::copy(&mut src, &mut zip).map_err(|e| werr(&e))?;
            }
            Err(_) => skipped.push(rel),
        }
        if done % 50 == 0 || done == total {
            progress(Progress { done, total });
        }
    }

    let spaces = entries
        .iter()
        .filter(|e| e.depth() == 1 && e.file_type().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    let manifest = Manifest {
        version: MANIFEST_VERSION,
        app_version: app_version.to_string(),
        created_at,
        spaces,
        files: done - skipped.len() as u64,
        bytes,
        skipped,
    };
    let json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    zip.start_file(MANIFEST_FILE, opts).map_err(|e| werr(&e))?;
    zip.write_all(&json).map_err(|e| werr(&e))?;

    let writer = zip.finish().map_err(|e| werr(&e))?;
    let file = writer.into_inner().map_err(|e| werr(&e.error()))?;
    file.sync_all().map_err(|e| werr(&e))?;
    drop(file);

    let final_path = dest.join(&name);
    fs::rename(&tmp, &final_path).map_err(|e| format!("Não foi possível finalizar o backup: {e}"))?;
    let size = fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
    Ok(BackupInfo {
        file: name,
        size,
        created_at,
        spaces: manifest.spaces,
        files: manifest.files,
        skipped: manifest.skipped,
    })
}

fn read_manifest(path: &Path) -> Option<Manifest> {
    let mut archive = ZipArchive::new(File::open(path).ok()?).ok()?;
    let mut entry = archive.by_name(MANIFEST_FILE).ok()?;
    let mut json = String::new();
    entry.read_to_string(&mut json).ok()?;
    serde_json::from_str(&json).ok()
}

fn is_backup_name(name: &str) -> bool {
    name.starts_with(PREFIX) && name.ends_with(".zip")
}

/// Backups válidos (com manifest) em `dest`, do mais novo para o mais antigo.
pub fn list(dest: &Path) -> Vec<BackupInfo> {
    let Ok(read) = fs::read_dir(dest) else { return Vec::new() };
    let mut out: Vec<BackupInfo> = read
        .flatten()
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().into_owned();
            if !is_backup_name(&file) || !e.path().is_file() {
                return None;
            }
            let m = read_manifest(&e.path())?;
            Some(BackupInfo {
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
                file,
                created_at: m.created_at,
                spaces: m.spaces,
                files: m.files,
                skipped: m.skipped,
            })
        })
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.file.cmp(&a.file)));
    out
}

/// `.zip.tmp` deixados por backups interrompidos.
pub fn stale_tmps(dest: &Path) -> Vec<PathBuf> {
    let Ok(read) = fs::read_dir(dest) else { return Vec::new() };
    read.flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            n.starts_with(PREFIX) && n.ends_with(TMP_EXT)
        })
        .map(|e| e.path())
        .collect()
}

/// Backups que a retenção em camadas descarta. `backups` deve vir do mais novo
/// para o mais antigo (como `list` devolve).
pub fn to_prune(backups: &[BackupInfo]) -> Vec<String> {
    let mut keep: HashSet<&str> = HashSet::new();
    let mut tier = |limit: usize, key: &dyn Fn(i64) -> Option<String>| {
        let mut seen: Vec<String> = Vec::new();
        for b in backups {
            let Some(k) = key(b.created_at) else { continue };
            if seen.contains(&k) {
                continue;
            }
            if seen.len() == limit {
                break;
            }
            seen.push(k);
            keep.insert(b.file.as_str());
        }
    };
    let local = |ts: i64| Local.timestamp_opt(ts, 0).single();
    tier(KEEP_HOURS, &|ts| local(ts).map(|d| d.format("%Y-%m-%d %H").to_string()));
    tier(KEEP_DAYS, &|ts| local(ts).map(|d| d.format("%Y-%m-%d").to_string()));
    tier(KEEP_WEEKS, &|ts| {
        local(ts).map(|d| {
            let w = d.iso_week();
            format!("{}-{}", w.year(), w.week())
        })
    });
    backups
        .iter()
        .filter(|b| !keep.contains(b.file.as_str()))
        .map(|b| b.file.clone())
        .collect()
}

/// Caminho de um backup de `dest` pelo nome (sem aceitar caminhos).
pub fn path_of(dest: &Path, file: &str) -> Res<PathBuf> {
    if !is_backup_name(file) || file.contains(['/', '\\']) || file.contains("..") {
        return Err("Backup inválido.".into());
    }
    let p = dest.join(file);
    if !p.is_file() {
        return Err("Backup não encontrado.".into());
    }
    Ok(p)
}

/// Extrai o backup numa pasta nova ao lado de `root` (`<raiz>-restaurado-<data>`).
/// Devolve a pasta criada. Se falhar no meio, a pasta parcial vai para a Lixeira.
pub fn restore(zip_path: &Path, root: &Path) -> Res<PathBuf> {
    let manifest = read_manifest(zip_path).ok_or("Este arquivo não é um backup válido.")?;
    validate_paths(zip_path)?;
    let parent = root.parent().ok_or("A pasta de projetos não tem pasta-mãe.")?;
    let base = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Projetos".into());
    let stamp = Local
        .timestamp_opt(manifest.created_at, 0)
        .single()
        .map(|d| d.format("%Y-%m-%d_%H%M").to_string())
        .unwrap_or_else(|| manifest.created_at.to_string());
    let mut target = parent.join(format!("{base}-restaurado-{stamp}"));
    let mut n = 2;
    while target.exists() {
        target = parent.join(format!("{base}-restaurado-{stamp}-{n}"));
        n += 1;
    }
    fs::create_dir_all(&target).map_err(|e| format!("Não foi possível criar {}: {e}", target.display()))?;

    let result = extract(zip_path, &target);
    if let Err(e) = result {
        let _ = trash::delete(&target);
        return Err(e);
    }
    Ok(target)
}

/// Recusa o backup inteiro (antes de criar qualquer pasta) se algum caminho
/// for absoluto ou tiver `..` (zip-slip).
fn validate_paths(zip_path: &Path) -> Res<()> {
    let rerr = |e: &dyn std::fmt::Display| format!("Erro ao ler o backup: {e}");
    let mut archive = ZipArchive::new(File::open(zip_path).map_err(|e| rerr(&e))?).map_err(|e| rerr(&e))?;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| rerr(&e))?;
        if entry.enclosed_name().is_none() {
            let name = entry.name().map(|n| n.into_owned()).unwrap_or_default();
            return Err(format!("Caminho inválido no backup: {name}"));
        }
    }
    Ok(())
}

fn extract(zip_path: &Path, target: &Path) -> Res<()> {
    let rerr = |e: &dyn std::fmt::Display| format!("Erro ao ler o backup: {e}");
    let mut archive = ZipArchive::new(File::open(zip_path).map_err(|e| rerr(&e))?).map_err(|e| rerr(&e))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| rerr(&e))?;
        let name = entry.name().map(|n| n.into_owned()).unwrap_or_default();
        if name == MANIFEST_FILE {
            continue;
        }
        // `enclosed_name` recusa caminhos absolutos e `..` (zip-slip).
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("Caminho inválido no backup: {name}"));
        };
        let out = target.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| rerr(&e))?;
            continue;
        }
        if let Some(dir) = out.parent() {
            fs::create_dir_all(dir).map_err(|e| rerr(&e))?;
        }
        let mut f = File::create(&out).map_err(|e| format!("Não foi possível criar {}: {e}", out.display()))?;
        io::copy(&mut entry, &mut f).map_err(|e| rerr(&e))?;
    }
    Ok(())
}

/// Algo na raiz (fora das exclusões) mudou depois de `since` (segundos)?
/// Pastas contam: criar, apagar ou renomear dentro delas muda a data delas.
pub fn changed_since(root: &Path, exclusions: &[String], since: i64) -> bool {
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !excluded(&e.file_name().to_string_lossy(), exclusions));
    walker.flatten().any(|e| {
        e.metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .is_some_and(|d| d.as_secs() as i64 > since)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("logstudio-backup-{name}-{}", now_secs_nanos()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn now_secs_nanos() -> u128 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
    }

    fn sample_root(base: &Path) -> PathBuf {
        let root = base.join("Projetos");
        let p = root.join("Pessoal").join("Projeto A");
        fs::create_dir_all(p.join(".logstudio").join("quadros")).unwrap();
        fs::create_dir_all(p.join("node_modules").join("lib")).unwrap();
        fs::create_dir_all(p.join(".git")).unwrap();
        fs::create_dir_all(root.join("Trabalho").join("Vazio")).unwrap();
        fs::write(root.join(".logstudio-workspaces.json"), "{}").unwrap();
        fs::write(root.join("Pessoal").join(".logstudio.json"), "{\"canvas\":1}").unwrap();
        fs::write(p.join("notas.md"), "olá").unwrap();
        fs::write(p.join(".logstudio").join("quadros").join("q.excalidraw"), "{}").unwrap();
        fs::write(p.join("node_modules").join("lib").join("x.js"), "x").unwrap();
        fs::write(p.join(".git").join("HEAD"), "ref").unwrap();
        fs::write(p.join("lixo.tmp"), "t").unwrap();
        root
    }

    fn files_under(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = WalkDir::new(dir)
            .into_iter()
            .flatten()
            .filter(|e| e.depth() > 0)
            .map(|e| zip_name(dir, e.path()).unwrap())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn exclusion_patterns() {
        let ex = default_exclusions();
        assert!(excluded("node_modules", &ex));
        assert!(excluded("Node_Modules", &ex));
        assert!(excluded("a.TMP", &ex));
        assert!(!excluded("targets", &ex));
        assert!(!excluded("notas.md", &ex));
        assert!(!excluded("x", &["".into(), "*".into()]));
    }

    #[test]
    fn creates_lists_and_restores() {
        let base = temp("roundtrip");
        let root = sample_root(&base);
        let dest = base.join("Backups");
        let mut last = Progress { done: 0, total: 0 };
        let info = create(&root, &dest, &default_exclusions(), "0.0.0", &AtomicBool::new(false), |p| last = p)
            .unwrap();

        assert!(is_backup_name(&info.file));
        assert_eq!(info.spaces, vec!["Pessoal".to_string(), "Trabalho".to_string()]);
        assert_eq!(info.files, 4);
        assert_eq!((last.done, last.total), (4, 4));
        assert!(stale_tmps(&dest).is_empty());

        let listed = list(&dest);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file, info.file);

        let restored = restore(&path_of(&dest, &info.file).unwrap(), &root).unwrap();
        assert!(restored.file_name().unwrap().to_string_lossy().starts_with("Projetos-restaurado-"));
        let expected = vec![
            ".logstudio-workspaces.json",
            "Pessoal",
            "Pessoal/.logstudio.json",
            "Pessoal/Projeto A",
            "Pessoal/Projeto A/.logstudio",
            "Pessoal/Projeto A/.logstudio/quadros",
            "Pessoal/Projeto A/.logstudio/quadros/q.excalidraw",
            "Pessoal/Projeto A/notas.md",
            "Trabalho",
            "Trabalho/Vazio",
        ];
        assert_eq!(files_under(&restored), expected);
        assert_eq!(fs::read_to_string(restored.join("Pessoal/Projeto A/notas.md")).unwrap(), "olá");

        // Uma segunda restauração do mesmo backup não sobrescreve a primeira.
        let again = restore(&path_of(&dest, &info.file).unwrap(), &root).unwrap();
        assert_ne!(again, restored);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn skips_backup_dir_inside_root() {
        let base = temp("inside");
        let root = sample_root(&base);
        let dest = root.join("Backups");
        let ex = default_exclusions();
        create(&root, &dest, &ex, "0.0.0", &AtomicBool::new(false), |_| {}).unwrap();
        let second = create(&root, &dest, &ex, "0.0.0", &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(second.files, 4, "o backup anterior não pode entrar no novo");
        assert_eq!(list(&dest).len(), 2);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn cancel_leaves_only_tmp() {
        let base = temp("cancel");
        let root = sample_root(&base);
        let dest = base.join("Backups");
        let err = create(&root, &dest, &default_exclusions(), "0.0.0", &AtomicBool::new(true), |_| {}).unwrap_err();
        assert_eq!(err, "Backup cancelado.");
        assert!(list(&dest).is_empty());
        assert_eq!(stale_tmps(&dest).len(), 1);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn path_of_rejects_paths() {
        let base = temp("pathof");
        assert!(path_of(&base, "..\\x.zip").is_err());
        assert!(path_of(&base, "LogStudio-backup-../../x.zip").is_err());
        assert!(path_of(&base, "outro.zip").is_err());
        assert_eq!(path_of(&base, "LogStudio-backup-1.zip").unwrap_err(), "Backup não encontrado.");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn restore_rejects_zip_slip() {
        let base = temp("slip");
        let zip_path = base.join("LogStudio-backup-mau.zip");
        let mut zip = ZipWriter::new(File::create(&zip_path).unwrap());
        let opts = SimpleFileOptions::default();
        zip.start_file("../fora.txt", opts).unwrap();
        zip.write_all(b"x").unwrap();
        let m = Manifest {
            version: 1,
            app_version: "0".into(),
            created_at: 0,
            spaces: vec![],
            files: 1,
            bytes: 1,
            skipped: vec![],
        };
        zip.start_file(MANIFEST_FILE, opts).unwrap();
        zip.write_all(&serde_json::to_vec(&m).unwrap()).unwrap();
        zip.finish().unwrap();

        let root = base.join("Projetos");
        fs::create_dir_all(&root).unwrap();
        assert!(restore(&zip_path, &root).unwrap_err().starts_with("Caminho inválido"));
        assert!(!base.join("fora.txt").exists());
        // Nada foi criado (nem foi para a Lixeira).
        assert_eq!(fs::read_dir(&base).unwrap().count(), 2);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn detects_changes() {
        let base = temp("changed");
        let root = sample_root(&base);
        let ex = default_exclusions();
        assert!(changed_since(&root, &ex, now_secs() - 3600));
        assert!(!changed_since(&root, &ex, now_secs() + 3600));
        let _ = fs::remove_dir_all(&base);
    }

    fn info(file: &str, ts: i64) -> BackupInfo {
        BackupInfo { file: file.into(), size: 0, created_at: ts, spaces: vec![], files: 0, skipped: vec![] }
    }

    #[test]
    fn retention_tiers() {
        // Um backup por hora durante 40 dias, do mais novo para o mais antigo.
        let now = Local.with_ymd_and_hms(2026, 11, 17, 12, 30, 0).unwrap().timestamp();
        let backups: Vec<BackupInfo> = (0..40 * 24).map(|h| info(&format!("b{h}"), now - h * 3600)).collect();
        let pruned = to_prune(&backups);
        let kept: Vec<&BackupInfo> = backups.iter().filter(|b| !pruned.contains(&b.file)).collect();

        // As 24 horas mais recentes ficam.
        for b in &backups[..24] {
            assert!(!pruned.contains(&b.file), "{} deveria ficar", b.file);
        }
        // No máximo 24 + 7 + 4; 4 semanas (do calendário) representadas.
        assert!(kept.len() <= KEEP_HOURS + KEEP_DAYS + KEEP_WEEKS);
        assert!(kept.len() > KEEP_HOURS);
        let weeks: HashSet<u32> = kept
            .iter()
            .map(|b| Local.timestamp_opt(b.created_at, 0).unwrap().iso_week().week())
            .collect();
        assert_eq!(weeks.len(), KEEP_WEEKS);
        let oldest = kept.iter().map(|b| b.created_at).min().unwrap();
        assert!(now - oldest >= 14 * 24 * 3600, "deveria guardar semanas antigas");
        // Os mais antigos de todos (40 dias) saem.
        assert!(pruned.contains(&backups.last().unwrap().file));
    }

    #[test]
    fn retention_keeps_newest_of_same_hour() {
        let t = Local.with_ymd_and_hms(2026, 11, 17, 10, 10, 0).unwrap().timestamp();
        let backups = vec![info("novo", t + 600), info("velho", t)];
        assert_eq!(to_prune(&backups), vec!["velho".to_string()]);
    }
}
