// Origem de um arquivo pedido pelo agente: URL http(s) (baixada aqui) ou caminho local
// (absoluto, ou relativo ao diretório do projeto).

use std::path::{Path, PathBuf};
use std::time::Duration;

type Res<T> = Result<T, String>;

pub enum Source {
    Url(String),
    Path(PathBuf),
}

pub fn resolve(project: &Path, source: &str) -> Res<Source> {
    let s = source.trim();
    if s.is_empty() {
        return Err("Informe o caminho ou a URL do arquivo.".into());
    }
    let lower = s.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(Source::Url(s.to_string()));
    }
    if lower.contains("://") {
        return Err("Só são aceitas URLs http ou https.".into());
    }
    let path = Path::new(s);
    let path = if path.is_absolute() { path.to_path_buf() } else { project.join(path) };
    if !path.is_file() {
        return Err(format!("Arquivo não encontrado: {}", path.display()));
    }
    Ok(Source::Path(path))
}

/// Baixa uma URL (até `limit` bytes). Devolve os bytes e o nome do arquivo tirado da URL.
pub fn download(url: &str, limit: u64) -> Res<(Vec<u8>, String)> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(60)))
        .build()
        .into();
    let mut resp = agent
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LogStudioAI")
        .call()
        .map_err(|e| format!("Não foi possível baixar {url}: {e}"))?;
    let bytes = resp
        .body_mut()
        .with_config()
        .limit(limit)
        .read_to_vec()
        .map_err(|e| format!("Não foi possível baixar {url}: {e}"))?;
    Ok((bytes, name_from_url(url)))
}

/// Último trecho do caminho da URL ("" se não houver).
pub fn name_from_url(url: &str) -> String {
    let no_query = url.split(['?', '#']).next().unwrap_or("");
    let path = no_query.splitn(4, '/').nth(3).unwrap_or("");
    let last = path.rsplit('/').next().unwrap_or("");
    crate::percent_decode(last).unwrap_or_else(|| last.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_sources() {
        assert_eq!(name_from_url("https://x.com/a/b/foto%20praia.png?w=1"), "foto praia.png");
        assert_eq!(name_from_url("https://x.com/"), "");
        assert_eq!(name_from_url("https://x.com"), "");

        let dir = std::env::temp_dir();
        assert!(matches!(resolve(&dir, "https://x.com/a.png"), Ok(Source::Url(_))));
        assert!(resolve(&dir, "ftp://x.com/a.png").is_err());
        assert!(resolve(&dir, "file:///C:/x.png").is_err());
        assert!(resolve(&dir, "nao-existe-xyz.png").is_err());
        assert!(resolve(&dir, "  ").is_err());
    }
}
