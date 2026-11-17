//! Changelog: releases publicados no GitHub (versão, data e descrição em Markdown).
//!
//! Lê a API pública (sem login). `LOGSTUDIO_RELEASES_FILE` (testes e2e) substitui a
//! API por um arquivo JSON local no mesmo formato.

use serde::{Deserialize, Serialize};
use std::time::Duration;

type Res<T> = Result<T, String>;

const API_URL: &str = "https://api.github.com/repos/GabrielT7878/log-studio-ai/releases?per_page=30";
const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// Um release mostrado na aba Atualizações.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub name: String,
    /// Descrição em Markdown (o changelog).
    pub body: String,
    /// Data ISO 8601 (UTC).
    pub published_at: Option<String>,
    pub url: String,
    /// Mais nova que a versão instalada.
    pub newer: bool,
}

/// `"v1.2.3"` → `[1, 2, 3]` (partes não numéricas, como `-beta`, são ignoradas).
fn version_parts(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()
        .unwrap_or("")
        .split('.')
        .map(|p| p.parse().unwrap_or(0))
        .collect()
}

/// `a` é mais nova que `b`?
pub fn is_newer(a: &str, b: &str) -> bool {
    let (mut a, mut b) = (version_parts(a), version_parts(b));
    let n = a.len().max(b.len());
    a.resize(n, 0);
    b.resize(n, 0);
    a > b
}

/// Converte a resposta da API (lista de releases) em `ReleaseInfo`, do mais novo
/// para o mais antigo, sem rascunhos nem pré-releases.
pub fn parse(json: &str, current: &str) -> Res<Vec<ReleaseInfo>> {
    let list: Vec<GhRelease> =
        serde_json::from_str(json).map_err(|e| format!("Resposta inesperada do GitHub: {e}"))?;
    let mut out: Vec<ReleaseInfo> = list
        .into_iter()
        .filter(|r| !r.draft && !r.prerelease)
        .map(|r| {
            let version = r.tag_name.trim_start_matches(['v', 'V']).to_string();
            ReleaseInfo {
                newer: is_newer(&version, current),
                name: r.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| r.tag_name.clone()),
                body: r.body.unwrap_or_default(),
                published_at: r.published_at,
                url: r.html_url,
                version,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        if is_newer(&a.version, &b.version) {
            std::cmp::Ordering::Less
        } else if is_newer(&b.version, &a.version) {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
    Ok(out)
}

/// Busca os releases (API do GitHub, ou `LOGSTUDIO_RELEASES_FILE` nos testes).
pub fn fetch(current: &str) -> Res<Vec<ReleaseInfo>> {
    if let Some(file) = std::env::var_os("LOGSTUDIO_RELEASES_FILE") {
        let json = std::fs::read_to_string(&file).map_err(|e| format!("Não foi possível ler os releases: {e}"))?;
        return parse(&json, current);
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .into();
    let mut resp = agent
        .get(API_URL)
        .header("User-Agent", "LogStudioAI")
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Não foi possível consultar as versões no GitHub: {e}"))?;
    let json = resp
        .body_mut()
        .with_config()
        .limit(MAX_BYTES)
        .read_to_string()
        .map_err(|e| format!("Não foi possível ler as versões do GitHub: {e}"))?;
    parse(&json, current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(is_newer("v0.2.0", "0.1.99"));
        assert!(is_newer("1.0", "0.9.9"));
        assert!(!is_newer("0.1.5", "0.1.5"));
        assert!(!is_newer("0.1.5", "v0.1.5"));
        assert!(!is_newer("0.1.4", "0.1.5"));
        assert!(!is_newer("1.0.0", "1.0"));
    }

    #[test]
    fn parses_sorts_and_flags_newer() {
        let json = r#"[
            {"tag_name":"v0.1.5","name":"Log Studio AI v0.1.5","body":"- b","published_at":"2026-11-17T16:36:44Z","html_url":"u5","draft":false,"prerelease":false},
            {"tag_name":"v0.1.10","name":"","body":null,"published_at":null,"html_url":"u10","draft":false,"prerelease":false},
            {"tag_name":"v0.2.0","name":"x","body":"","html_url":"r","draft":true,"prerelease":false},
            {"tag_name":"v0.3.0-beta","name":"x","body":"","html_url":"p","draft":false,"prerelease":true},
            {"tag_name":"v0.1.4","name":"Log Studio AI v0.1.4","body":"- a","html_url":"u4","draft":false,"prerelease":false}
        ]"#;
        let list = parse(json, "0.1.5").unwrap();
        let versions: Vec<&str> = list.iter().map(|r| r.version.as_str()).collect();
        assert_eq!(versions, ["0.1.10", "0.1.5", "0.1.4"]);
        assert!(list[0].newer && !list[1].newer && !list[2].newer);
        assert_eq!(list[0].name, "v0.1.10", "nome vazio usa a tag");
        assert_eq!(list[0].body, "");
        assert_eq!(list[1].body, "- b");
    }

    #[test]
    fn rejects_unexpected_response() {
        assert!(parse(r#"{"message":"API rate limit exceeded"}"#, "0.1.0")
            .unwrap_err()
            .starts_with("Resposta inesperada"));
    }
}
