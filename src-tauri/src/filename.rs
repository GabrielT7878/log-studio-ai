//! Nomes dos arquivos copiados para o projeto (anexos e imagens do canvas):
//! `<nome original simplificado>-<id de 8 hex>.<ext>`, ex.: "Relatorio_Final_1-7f3a9c2e.pdf".
//! Legível na pasta e ainda único. Só usa letras sem acento, números, `-` e `_`.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Tamanho máximo da parte do nome (o total fica ≤ 64 com o id).
const MAX_SLUG: usize = 50;

/// Letra acentuada (latim) → letra sem acento.
fn unaccent(c: char) -> Option<char> {
    Some(match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'Á' | 'À' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'A',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'É' | 'È' | 'Ê' | 'Ë' => 'E',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'Í' | 'Ì' | 'Î' | 'Ï' => 'I',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'O',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'Ú' | 'Ù' | 'Û' | 'Ü' => 'U',
        'ç' => 'c',
        'Ç' => 'C',
        'ñ' => 'n',
        'Ñ' => 'N',
        _ => return None,
    })
}

/// "Relatório Final (1)" → "Relatorio_Final_1". Vazio se não sobrar nada.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        let c = unaccent(c).unwrap_or(c);
        if c.is_ascii_alphanumeric() || c == '-' {
            out.push(c);
        } else if !out.ends_with('_') {
            out.push('_'); // espaço, pontuação, emoji… viram um só "_"
        }
    }
    let out = out.trim_matches(['_', '-']);
    let cut: String = out.chars().take(MAX_SLUG).collect();
    cut.trim_end_matches(['_', '-']).to_string()
}

/// Parte do nome sem a extensão e sem caminho ("C:\x\Foto.Final.png" → "Foto.Final").
pub fn stem(original: &str) -> &str {
    let base = original.rsplit(['/', '\\']).next().unwrap_or(original);
    match base.rsplit_once('.') {
        Some((s, _)) if !s.is_empty() => s,
        _ => base,
    }
}

fn short_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    // Mistura tempo e contador (constante do SplitMix64) e fica com 32 bits.
    let mut x = nanos ^ n.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 31;
    format!("{:08x}", x as u32)
}

/// Nome livre em `dir`: `<slug do original>-<id>[.ext]` (usa `fallback` se o slug ficar vazio).
pub fn unique_in(dir: &Path, original: &str, fallback: &str, ext: Option<&str>) -> String {
    let base = slug(stem(original));
    let base = if base.is_empty() { fallback.to_string() } else { base };
    loop {
        let name = match ext {
            Some(e) => format!("{base}-{}.{e}", short_id()),
            None => format!("{base}-{}", short_id()),
        };
        if !dir.join(&name).exists() {
            return name;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        assert_eq!(slug("Relatório Final (1)"), "Relatorio_Final_1");
        assert_eq!(slug("  ação -- ok!! "), "acao_--_ok");
        assert_eq!(slug("日本語"), "");
        assert_eq!(slug("a".repeat(80).as_str()).len(), MAX_SLUG);
    }

    #[test]
    fn stems() {
        assert_eq!(stem(r"C:\x\Foto.Final.png"), "Foto.Final");
        assert_eq!(stem("sem_ext"), "sem_ext");
        assert_eq!(stem(".bashrc"), ".bashrc");
    }

    #[test]
    fn unique_names() {
        let dir = std::env::temp_dir();
        let a = unique_in(&dir, "Relatório Final (1).pdf", "anexo", Some("pdf"));
        assert!(a.starts_with("Relatorio_Final_1-") && a.ends_with(".pdf"), "{a}");
        assert_eq!(a.len(), "Relatorio_Final_1-".len() + 8 + 4);
        assert!(unique_in(&dir, "日本.png", "imagem", Some("png")).starts_with("imagem-"));
        assert_ne!(unique_in(&dir, "x", "f", None), unique_in(&dir, "x", "f", None));
    }
}
