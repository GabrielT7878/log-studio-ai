//! Uso do plano dos agentes (limites de 5h, semanal e por modelo), pedido ao próprio CLI.
//!
//! Claude Code: abre `claude -p` em modo stream-json, manda o pedido de controle
//! `get_usage` e lê a resposta. Não envia prompt (não gasta cota). Com `--safe-mode`
//! não roda hooks, MCP nem plugins (mais rápido, sem efeitos colaterais); se a versão
//! instalada não aceitar a opção, tenta de novo sem ela.

use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

const REQUEST_ID: &str = "logstudio-usage";
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    /// "session", "weekly_all", "weekly_scoped"…
    pub kind: String,
    /// "session" ou "weekly".
    pub group: String,
    /// Nome do modelo, nos limites por modelo (ex.: "Fable").
    pub model: Option<String>,
    /// 0–100.
    pub percent: f64,
    /// "normal", "warning"…
    pub severity: Option<String>,
    /// ISO 8601.
    pub resets_at: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Report {
    #[serde(rename_all = "camelCase")]
    Ok {
        plan: Option<String>,
        /// false = a conta não tem limites de plano (ex.: login por chave de API).
        available: bool,
        limits: Vec<Limit>,
    },
    NotInstalled,
    Error { message: String },
}

enum Failure {
    NotInstalled,
    /// O processo terminou sem responder (ex.: opção desconhecida).
    NoAnswer(String),
    Other(String),
}

/// Abre o primeiro executável que existir entre `names` (ex.: "claude", "claude.cmd").
fn spawn_first(names: &[&str], args: &[&str]) -> Result<Child, Failure> {
    for name in names {
        let mut cmd = Command::new(name);
        cmd.args(args)
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(e) => return Err(Failure::Other(format!("Não foi possível abrir {name}: {e}"))),
        }
    }
    Err(Failure::NotInstalled)
}

/// Uma tentativa: abre o claude, pede o uso e espera a resposta.
fn ask_claude(safe_mode: bool) -> Result<Value, Failure> {
    let mut args = vec![
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
    ];
    if safe_mode {
        args.push("--safe-mode");
    }
    let mut child = spawn_first(&["claude", "claude.cmd"], &args)?;

    let request = serde_json::json!({
        "type": "control_request",
        "request_id": REQUEST_ID,
        "request": { "subtype": "get_usage", "skip_behaviors": true },
    });
    // O stdin fica aberto (fechar pode encerrar o claude antes da resposta).
    let mut stdin = child.stdin.take();
    if let Some(input) = stdin.as_mut() {
        let _ = writeln!(input, "{request}").and_then(|_| input.flush());
    }

    // Lê as linhas numa thread; a principal espera com tempo limite.
    let stdout = child.stdout.take();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let Some(out) = stdout else { return };
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            let ours = msg["type"] == "control_response" && msg["response"]["request_id"] == REQUEST_ID;
            if ours {
                let _ = tx.send(msg);
                return;
            }
        }
    });

    let result = match rx.recv_timeout(TIMEOUT) {
        Ok(msg) => {
            let resp = &msg["response"];
            if resp["subtype"] == "success" {
                Ok(resp["response"].clone())
            } else {
                let err = resp["error"].as_str().unwrap_or("resposta de erro").to_string();
                Err(Failure::Other(format!("Claude Code: {err}")))
            }
        }
        Err(mpsc::RecvTimeoutError::Timeout) => Err(Failure::Other("Claude Code não respondeu a tempo.".into())),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let mut err = String::new();
            if let Some(mut e) = child.stderr.take() {
                let _ = std::io::Read::read_to_string(&mut e, &mut err);
            }
            Err(Failure::NoAnswer(err.trim().chars().take(300).collect()))
        }
    };

    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64()
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

/// Resposta do `get_usage` → lista de limites. Usa `rate_limits.limits` (pronta);
/// sem ela, monta a partir de `five_hour`, `seven_day` e `model_scoped`.
fn parse(resp: &Value) -> Report {
    let rl = &resp["rate_limits"];
    let mut limits = Vec::new();

    if let Some(list) = rl["limits"].as_array() {
        for l in list {
            let Some(percent) = num(&l["percent"]) else { continue };
            limits.push(Limit {
                kind: text(&l["kind"]).unwrap_or_default(),
                group: text(&l["group"]).unwrap_or_default(),
                model: text(&l["scope"]["model"]["display_name"]),
                percent,
                severity: text(&l["severity"]),
                resets_at: text(&l["resets_at"]),
            });
        }
    } else {
        for (key, kind, group) in [("five_hour", "session", "session"), ("seven_day", "weekly_all", "weekly")] {
            if let Some(percent) = num(&rl[key]["utilization"]) {
                limits.push(Limit {
                    kind: kind.into(),
                    group: group.into(),
                    model: None,
                    percent,
                    severity: None,
                    resets_at: text(&rl[key]["resets_at"]),
                });
            }
        }
        for m in rl["model_scoped"].as_array().into_iter().flatten() {
            if let Some(percent) = num(&m["utilization"]) {
                limits.push(Limit {
                    kind: "weekly_scoped".into(),
                    group: "weekly".into(),
                    model: text(&m["display_name"]),
                    percent,
                    severity: None,
                    resets_at: text(&m["resets_at"]),
                });
            }
        }
    }

    Report::Ok {
        plan: text(&resp["subscription_type"]),
        available: resp["rate_limits_available"].as_bool().unwrap_or(!limits.is_empty()),
        limits,
    }
}

fn claude_usage() -> Report {
    let attempt = match ask_claude(true) {
        // Sem resposta com --safe-mode (ex.: versão antiga não conhece a opção): tenta sem.
        Err(Failure::NoAnswer(_)) => ask_claude(false),
        other => other,
    };
    match attempt {
        Ok(resp) => parse(&resp),
        Err(Failure::NotInstalled) => Report::NotInstalled,
        Err(Failure::NoAnswer(err)) => Report::Error {
            message: if err.is_empty() { "Claude Code encerrou sem responder.".into() } else { err },
        },
        Err(Failure::Other(message)) => Report::Error { message },
    }
}

/// Uso do plano de `agent` ("claude" ou "codex").
pub fn report(agent: &str) -> Report {
    match agent {
        "claude" => claude_usage(),
        "codex" => match spawn_first(&["codex", "codex.cmd"], &["--version"]) {
            Err(Failure::NotInstalled) => Report::NotInstalled,
            Ok(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
                Report::Error { message: "Leitura de uso do Codex ainda não implementada.".into() }
            }
            Err(_) => Report::Error { message: "Não foi possível abrir o Codex.".into() },
        },
        other => Report::Error { message: format!("Agente desconhecido: {other}") },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_ready_made_limits() {
        let resp = json!({
            "subscription_type": "pro",
            "rate_limits_available": true,
            "rate_limits": { "limits": [
                { "kind": "session", "group": "session", "percent": 23, "severity": "normal",
                  "resets_at": "2026-11-11T16:30:00+00:00", "scope": null },
                { "kind": "weekly_scoped", "group": "weekly", "percent": 0, "severity": "normal",
                  "resets_at": "2026-11-13T00:00:00+00:00", "scope": { "model": { "display_name": "Fable" } } }
            ]}
        });
        let Report::Ok { plan, available, limits } = parse(&resp) else { panic!("esperava Ok") };
        assert_eq!(plan.as_deref(), Some("pro"));
        assert!(available);
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].percent, 23.0);
        assert_eq!(limits[1].model.as_deref(), Some("Fable"));
    }

    /// Chama o claude de verdade (precisa estar instalado e logado): `cargo test -- --ignored live_claude`.
    #[test]
    #[ignore]
    fn live_claude() {
        let start = std::time::Instant::now();
        let r = report("claude");
        println!("{:?} em {:?}", r, start.elapsed());
        assert!(matches!(r, Report::Ok { .. }), "{r:?}");
    }

    #[test]
    fn falls_back_to_windows() {
        let resp = json!({
            "rate_limits": {
                "five_hour": { "utilization": 10, "resets_at": "a" },
                "seven_day": { "utilization": 40, "resets_at": "b" },
                "model_scoped": [{ "display_name": "Fable", "utilization": 5, "resets_at": "c" }]
            }
        });
        let Report::Ok { available, limits, .. } = parse(&resp) else { panic!("esperava Ok") };
        assert!(available);
        let kinds: Vec<_> = limits.iter().map(|l| l.kind.as_str()).collect();
        assert_eq!(kinds, ["session", "weekly_all", "weekly_scoped"]);
    }
}
