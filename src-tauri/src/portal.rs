// Portal (página web dentro do canvas, via iframe): descobre se o site permite ser
// embutido, lendo os cabeçalhos X-Frame-Options e Content-Security-Policy (frame-ancestors).

use serde::Serialize;
use std::time::Duration;

type Res<T> = Result<T, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameCheck {
    /// true = o site recusa ser mostrado dentro de outra página.
    pub blocked: bool,
}

/// X-Frame-Options: qualquer valor válido (DENY, SAMEORIGIN, ALLOW-FROM) recusa o app.
fn xfo_blocks(value: &str) -> bool {
    let v = value.trim().to_ascii_lowercase();
    v == "deny" || v == "sameorigin" || v.starts_with("allow-from")
}

/// CSP frame-ancestors: só libera se tiver "*" (o app não está em nenhuma lista de origens).
fn csp_blocks(value: &str) -> bool {
    value.split(';').any(|directive| {
        let mut parts = directive.split_whitespace();
        match parts.next() {
            Some(name) if name.eq_ignore_ascii_case("frame-ancestors") => !parts.any(|src| src == "*"),
            _ => false,
        }
    })
}

/// Consulta o site (segue redirecionamentos) e diz se ele bloqueia ser embutido.
/// Falha de rede não conta como bloqueio (o próprio iframe mostra o erro).
pub fn check(url: &str) -> Res<FrameCheck> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("Endereço inválido (use http ou https).".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(6)))
        .http_status_as_error(false)
        .build()
        .into();
    let Ok(resp) = agent
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LogStudioAI")
        .call()
    else {
        return Ok(FrameCheck { blocked: false });
    };
    let headers = resp.headers();
    let blocked = headers
        .get_all("x-frame-options")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .any(xfo_blocks)
        || headers
            .get_all("content-security-policy")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .any(csp_blocks);
    Ok(FrameCheck { blocked })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_frame_headers() {
        assert!(xfo_blocks("DENY"));
        assert!(xfo_blocks(" SameOrigin "));
        assert!(!xfo_blocks(""));

        assert!(csp_blocks("default-src 'self'; frame-ancestors 'self'"));
        assert!(csp_blocks("frame-ancestors 'none'"));
        assert!(csp_blocks("frame-ancestors https://example.com"));
        assert!(!csp_blocks("frame-ancestors *"));
        assert!(!csp_blocks("default-src 'self'; script-src 'self'"));
    }

    /// Usa a internet: `cargo test --lib portal -- --ignored`.
    #[test]
    #[ignore]
    fn live_sites() {
        assert!(check("https://github.com").unwrap().blocked);
        assert!(!check("https://example.com").unwrap().blocked);
    }

    #[test]
    fn rejects_non_http() {
        assert!(check("javascript:alert(1)").is_err());
        assert!(check("file:///C:/x").is_err());
    }
}
