// Portal com HTML local: servidor HTTP em 127.0.0.1 que serve só a pasta de cada HTML aberto.
//
// Cada pasta recebe um token aleatório e vira uma origem própria:
// `http://<token>.localhost:<porta>/<arquivo>`. Para o Tauri essa origem é remota (não chama
// comandos) e o iframe do Portal não recebe a chave de IPC. O servidor confere o token no
// cabeçalho Host, aceita só GET/HEAD, não lista pastas e recusa "..", links que saem da pasta
// e arquivos/pastas ocultos (".env", ".git", ".logstudio").

use crate::files;
use std::collections::HashMap;
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use tiny_http::{Header, Method, Request, Response, Server};

type Res<T> = Result<T, String>;

pub struct LocalSites {
    port: u16,
    /// token → pasta servida.
    roots: Mutex<HashMap<String, PathBuf>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn new_token() -> Res<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("Não foi possível gerar o token: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Codifica cada parte do caminho para a URL ("/" separa as partes).
fn encode_path(rel: &str) -> String {
    rel.split('/')
        .map(|part| {
            part.bytes()
                .map(|b| {
                    if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                        (b as char).to_string()
                    } else {
                        format!("%{b:02X}")
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Tipo do arquivo pela extensão (o servidor manda `nosniff`, então precisa estar certo).
fn mime(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "txt" | "md" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

/// O caminho tem alguma parte oculta (começa com ".")?
fn has_hidden_part(rel: &str) -> bool {
    Path::new(rel).components().any(|c| match c {
        Component::Normal(part) => part.to_string_lossy().starts_with('.'),
        _ => false,
    })
}

/// Arquivo é uma página HTML?
pub fn is_html(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("html" | "htm")
    )
}

impl LocalSites {
    /// Sobe o servidor numa porta livre de 127.0.0.1.
    pub fn start() -> Res<Arc<LocalSites>> {
        let server = Server::http("127.0.0.1:0").map_err(|e| format!("Servidor do Portal: {e}"))?;
        let port = server
            .server_addr()
            .to_ip()
            .map(|a| a.port())
            .ok_or("Servidor do Portal: endereço inválido.")?;
        let sites = Arc::new(LocalSites::new(port));
        let s = sites.clone();
        std::thread::spawn(move || {
            for request in server.incoming_requests() {
                let s = s.clone();
                std::thread::spawn(move || s.handle(request));
            }
        });
        Ok(sites)
    }

    fn new(port: u16) -> LocalSites {
        LocalSites { port, roots: Mutex::new(HashMap::new()) }
    }

    /// URL do HTML `file` servindo a pasta `root` (que contém o arquivo).
    /// A mesma pasta reaproveita o mesmo token (mesma origem, mesmo localStorage).
    pub fn url_for(&self, root: &Path, file: &Path) -> Res<String> {
        let rel = file
            .strip_prefix(root)
            .map_err(|_| "Arquivo fora da pasta servida.".to_string())?
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/");
        let mut roots = lock(&self.roots);
        let token = match roots.iter().find(|(_, r)| r.as_path() == root) {
            Some((t, _)) => t.clone(),
            None => {
                let t = new_token()?;
                roots.insert(t.clone(), root.to_path_buf());
                t
            }
        };
        Ok(format!("http://{token}.localhost:{}/{}", self.port, encode_path(&rel)))
    }

    /// Pedido → arquivo a servir, ou o status HTTP de erro.
    fn resolve_request(&self, host: Option<&str>, method: &Method, raw_url: &str) -> Result<PathBuf, u16> {
        if !matches!(method, Method::Get | Method::Head) {
            return Err(405);
        }
        // Host: "<token>.localhost:<porta>" (também barra DNS rebinding).
        let host = host.ok_or(404u16)?.to_ascii_lowercase();
        let token = host
            .strip_suffix(&format!(".localhost:{}", self.port))
            .ok_or(404u16)?;
        let root = lock(&self.roots).get(token).cloned().ok_or(404u16)?;

        let path = raw_url.split(['?', '#']).next().unwrap_or("");
        let rel = crate::percent_decode(path).ok_or(400u16)?;
        let rel = rel.trim_start_matches('/');
        if has_hidden_part(rel) {
            return Err(404);
        }
        let mut file = files::resolve(&root, rel).map_err(|_| 404u16)?;
        if file.is_dir() {
            file.push("index.html");
        }
        if !file.is_file() {
            return Err(404);
        }
        Ok(file)
    }

    fn handle(&self, request: Request) {
        let host = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Host"))
            .map(|h| h.value.as_str().to_string());
        let header = |k: &str, v: &str| Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("cabeçalho válido");
        match self.resolve_request(host.as_deref(), request.method(), request.url()) {
            Ok(path) => match File::open(&path) {
                Ok(f) => {
                    let response = Response::from_file(f)
                        .with_header(header("Content-Type", mime(&path)))
                        .with_header(header("X-Content-Type-Options", "nosniff"))
                        .with_header(header("Cache-Control", "no-store"));
                    let _ = request.respond(response);
                }
                Err(_) => {
                    let _ = request.respond(Response::empty(404));
                }
            },
            Err(status) => {
                let _ = request.respond(Response::empty(status));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn site() -> (LocalSites, PathBuf, String) {
        let base = std::env::temp_dir().join(format!("logstudio-site-{}", new_token().unwrap()));
        let root = base.join("site");
        fs::create_dir_all(root.join("css")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("index.html"), "<h1>oi</h1>").unwrap();
        fs::write(root.join("css/estilo é.css"), "h1{}").unwrap();
        fs::write(root.join(".env"), "SEGREDO=1").unwrap();
        fs::write(root.join(".git/config"), "x").unwrap();
        fs::write(base.join("fora.txt"), "fora").unwrap();
        let sites = LocalSites::new(4321);
        let url = sites.url_for(&root, &root.join("index.html")).unwrap();
        let host = url
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap()
            .to_string();
        (sites, root, host)
    }

    #[test]
    fn serves_files_of_the_folder() {
        let (s, root, host) = site();
        let get = |u: &str| s.resolve_request(Some(&host), &Method::Get, u);
        assert_eq!(get("/index.html").unwrap(), root.join("index.html"));
        assert_eq!(get("/").unwrap(), root.join("index.html"));
        assert_eq!(get("/css/estilo%20%C3%A9.css?v=2#x").unwrap(), root.join("css").join("estilo é.css"));
        assert!(s.resolve_request(Some(&host), &Method::Head, "/index.html").is_ok());
    }

    #[test]
    fn refuses_escapes_hidden_and_unknown() {
        let (s, _root, host) = site();
        let get = |u: &str| s.resolve_request(Some(&host), &Method::Get, u);
        assert_eq!(get("/../fora.txt"), Err(404));
        assert_eq!(get("/%2e%2e/fora.txt"), Err(404));
        assert_eq!(get("/..%5Cfora.txt"), Err(404));
        assert_eq!(get("/.env"), Err(404));
        assert_eq!(get("/.git/config"), Err(404));
        assert_eq!(get("/nao-existe.html"), Err(404));
        assert_eq!(get("/css"), Err(404));
        // Método, token e porta errados.
        assert_eq!(s.resolve_request(Some(&host), &Method::Post, "/index.html"), Err(405));
        assert_eq!(s.resolve_request(None, &Method::Get, "/index.html"), Err(404));
        assert_eq!(s.resolve_request(Some("abc.localhost:4321"), &Method::Get, "/index.html"), Err(404));
        assert_eq!(s.resolve_request(Some("localhost:4321"), &Method::Get, "/index.html"), Err(404));
        let other_port = host.replace(":4321", ":9999");
        assert_eq!(s.resolve_request(Some(&other_port), &Method::Get, "/index.html"), Err(404));
    }

    #[test]
    fn same_folder_reuses_token() {
        let (s, root, host) = site();
        let again = s.url_for(&root, &root.join("css").join("estilo é.css")).unwrap();
        assert_eq!(again, format!("http://{host}/css/estilo%20%C3%A9.css"));
    }

    #[test]
    fn mime_and_html() {
        assert_eq!(mime(Path::new("a.HTML")), "text/html; charset=utf-8");
        assert_eq!(mime(Path::new("a.mjs")), "text/javascript; charset=utf-8");
        assert_eq!(mime(Path::new("a.bin")), "application/octet-stream");
        assert!(is_html(Path::new("x/Index.htm")));
        assert!(!is_html(Path::new("x/index.php")));
    }
}
