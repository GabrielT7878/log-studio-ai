//! Terminais de verdade (ConPTY no Windows) para os cards do canvas.
//!
//! - Cada sessão tem um `id` (o id do card no frontend).
//! - O programa é escolhido aqui a partir de uma lista fixa (`Agent`). A exceção é
//!   `Agent::Script`: a janela Script do canvas roda um comando definido pelo usuário (ou
//!   pelo agente, com aprovação do usuário no frontend). O terminal PowerShell já aceita
//!   qualquer texto digitado (`write`), então isso não abre uma capacidade nova.
//! - A saída vai para o frontend por um `Channel`, em texto UTF-8 (sequências
//!   quebradas entre leituras são remontadas).
//! - Reiniciar = iniciar de novo com o mesmo id (a sessão antiga é encerrada).

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::ipc::Channel;

type Res<T> = Result<T, String>;

/// Evento enviado ao frontend.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PtyEvent {
    Data { data: String },
    Exit { code: Option<u32> },
}

/// Tamanho máximo do comando de um Script.
pub const SCRIPT_MAX: usize = 4000;

/// O que roda no terminal.
#[derive(Clone, Debug)]
pub enum Agent {
    Shell,
    Claude,
    Codex,
    /// Comando do PowerShell (janela Script); o processo termina com o comando.
    Script(String),
}

impl Agent {
    pub fn parse(s: &str, command: Option<String>) -> Res<Self> {
        match s {
            "shell" => Ok(Agent::Shell),
            "claude" => Ok(Agent::Claude),
            "codex" => Ok(Agent::Codex),
            "script" => {
                let cmd = command.unwrap_or_default();
                if cmd.trim().is_empty() {
                    return Err("O script não tem comando.".into());
                }
                if cmd.chars().count() > SCRIPT_MAX {
                    return Err(format!("O comando passa do limite de {SCRIPT_MAX} caracteres."));
                }
                if cmd.contains('\0') {
                    return Err("O comando tem um caractere inválido.".into());
                }
                Ok(Agent::Script(cmd))
            }
            _ => Err(format!("Tipo de terminal desconhecido: {s}")),
        }
    }
}

/// Ligação do terminal com o canvas (ponte MCP do agente).
pub struct CanvasLink {
    /// Arquivo passado em `--mcp-config` (Claude Code).
    pub mcp_config: std::path::PathBuf,
    pub url: String,
    pub token: String,
    pub terminal_id: String,
}

/// Texto entre aspas simples para o PowerShell ('' escapa ').
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn command_for(agent: &Agent, cwd: &Path, link: Option<&CanvasLink>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.arg("-NoLogo");
    if let Agent::Script(script) = agent {
        // Sem -NoExit: o processo termina com o comando e o código de saída vai ao frontend.
        cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script.as_str()]);
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        return cmd;
    }
    let program = match agent {
        Agent::Script(_) => None,
        Agent::Shell => None,
        Agent::Claude => Some(match link {
            Some(l) => format!("claude --mcp-config {}", ps_quote(&l.mcp_config.to_string_lossy())),
            None => "claude".to_string(),
        }),
        Agent::Codex => Some("codex".to_string()),
    };
    if let Some(l) = link {
        // Para scripts/CLIs futuras falarem com o canvas.
        cmd.env("LOGSTUDIO_MCP_URL", &l.url);
        cmd.env("LOGSTUDIO_TOKEN", &l.token);
        cmd.env("LOGSTUDIO_TERMINAL_ID", &l.terminal_id);
    }
    if let Some(program) = program {
        // -NoExit: ao sair do agente, continua no PowerShell.
        // Bypass (só neste processo): permite os atalhos .ps1 criados pelo npm.
        cmd.args(["-NoExit", "-ExecutionPolicy", "Bypass", "-Command", program.as_str()]);
    }
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd
}

struct Session {
    /// Distingue a sessão atual de uma anterior com o mesmo id (reinício).
    generation: u64,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Diretório em que o processo roda (o Windows não deixa excluir/mover uma pasta em uso).
    cwd: std::path::PathBuf,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    next_generation: Mutex<u64>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Tira de `pending` o maior trecho UTF-8 completo; guarda um caractere
/// incompleto no fim para a próxima leitura.
fn take_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let out = s.to_string();
            pending.clear();
            out
        }
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let out = String::from_utf8_lossy(&pending[..valid]).into_owned();
            pending.drain(..valid);
            out
        }
        Err(_) => {
            let out = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            out
        }
    }
}

impl PtyManager {
    pub fn spawn(
        &self,
        id: String,
        agent: Agent,
        cwd: &Path,
        cols: u16,
        rows: u16,
        channel: Channel<PtyEvent>,
        link: Option<CanvasLink>,
    ) -> Res<()> {
        if id.is_empty() || id.len() > 100 {
            return Err("Id de terminal inválido.".into());
        }
        // Reinício: encerra a sessão anterior com o mesmo id.
        self.kill(&id);

        let size = PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| format!("Não foi possível abrir o terminal: {e}"))?;
        let mut child = pair
            .slave
            .spawn_command(command_for(&agent, cwd, link.as_ref()))
            .map_err(|e| format!("Não foi possível iniciar o processo: {e}"))?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Não foi possível ler o terminal: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Não foi possível escrever no terminal: {e}"))?;

        let generation = {
            let mut g = lock(&self.next_generation);
            *g += 1;
            *g
        };
        lock(&self.sessions).insert(
            id.clone(),
            Session {
                generation,
                master: pair.master,
                writer,
                killer: child.clone_killer(),
                cwd: cwd.to_path_buf(),
            },
        );

        // Leitura da saída → frontend.
        let out = channel.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut pending = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let text = take_utf8(&mut pending);
                        if !text.is_empty() && out.send(PtyEvent::Data { data: text }).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        // Espera o processo terminar, avisa o frontend e libera a sessão.
        let sessions = self.sessions.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|status| status.exit_code());
            {
                let mut map = lock(&sessions);
                if map.get(&id).is_some_and(|s| s.generation == generation) {
                    map.remove(&id); // fecha o PTY → a thread de leitura termina
                }
            }
            let _ = channel.send(PtyEvent::Exit { code });
        });

        Ok(())
    }

    pub fn write(&self, id: &str, data: &str) -> Res<()> {
        let mut map = lock(&self.sessions);
        let session = map.get_mut(id).ok_or("Terminal não está rodando.")?;
        session
            .writer
            .write_all(data.as_bytes())
            .and_then(|_| session.writer.flush())
            .map_err(|e| format!("Não foi possível escrever no terminal: {e}"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Res<()> {
        let map = lock(&self.sessions);
        let session = map.get(id).ok_or("Terminal não está rodando.")?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Não foi possível redimensionar o terminal: {e}"))
    }

    pub fn kill(&self, id: &str) {
        if let Some(mut session) = lock(&self.sessions).remove(id) {
            let _ = session.killer.kill();
        }
    }

    /// Encerra os terminais que rodam em `dir` ou dentro dele (antes de mandar a pasta para a
    /// Lixeira). Devolve os ids encerrados.
    pub fn kill_under(&self, dir: &Path) -> Vec<String> {
        let drained: Vec<(String, Session)> = {
            let mut map = lock(&self.sessions);
            let ids: Vec<String> = map
                .iter()
                .filter(|(_, s)| s.cwd.starts_with(dir))
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter().filter_map(|id| map.remove(&id).map(|s| (id, s))).collect()
        };
        drained
            .into_iter()
            .map(|(id, mut session)| {
                let _ = session.killer.kill();
                id
            })
            .collect()
    }

    pub fn kill_all(&self) {
        let drained: Vec<Session> = lock(&self.sessions).drain().map(|(_, s)| s).collect();
        for mut session in drained {
            let _ = session.killer.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::ipc::InvokeResponseBody;

    /// Abre um PowerShell de verdade num PTY, executa um comando e confere a saída e o "exit".
    #[test]
    fn spawns_powershell_and_reports_output_and_exit() {
        let (tx, rx) = mpsc::channel::<String>();
        let channel: Channel<PtyEvent> = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                let _ = tx.send(json);
            }
            Ok(())
        });

        let manager = PtyManager::default();
        let cwd = std::env::temp_dir();
        manager.spawn("teste".into(), Agent::Shell, &cwd, 100, 30, channel, None).unwrap();
        // O ConPTY pergunta a posição do cursor (ESC[6n) e espera a resposta —
        // no app quem responde é o xterm.js; aqui respondemos à mão.
        std::thread::sleep(Duration::from_millis(500));
        manager.write("teste", "\x1b[1;1R").unwrap();
        std::thread::sleep(Duration::from_millis(1500));
        manager.write("teste", "echo LOGSTUDIO_$((20+22))\r").unwrap();
        std::thread::sleep(Duration::from_millis(800));
        manager.write("teste", "exit\r").unwrap();

        let mut output = String::new();
        let mut exited = false;
        while let Ok(msg) = rx.recv_timeout(Duration::from_secs(15)) {
            let event: serde_json::Value = serde_json::from_str(&msg).unwrap();
            match event["type"].as_str() {
                Some("data") => output.push_str(event["data"].as_str().unwrap_or("")),
                Some("exit") => {
                    exited = true;
                    break;
                }
                _ => {}
            }
        }
        assert!(output.contains("LOGSTUDIO_42"), "saída: {output}");
        assert!(exited, "não recebeu o evento de saída");
        assert!(manager.write("teste", "x").is_err(), "sessão deveria ter sido removida");
    }

    /// Script: roda o comando sem ficar no PowerShell e devolve o código de saída.
    #[test]
    fn script_runs_command_and_reports_exit_code() {
        let (tx, rx) = mpsc::channel::<String>();
        let channel: Channel<PtyEvent> = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                let _ = tx.send(json);
            }
            Ok(())
        });
        let manager = PtyManager::default();
        let agent = Agent::parse("script", Some("Write-Output LOGSTUDIO_$((40+2)); exit 3".into())).unwrap();
        manager.spawn("script".into(), agent, &std::env::temp_dir(), 100, 30, channel, None).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let _ = manager.write("script", "\x1b[1;1R");

        let mut output = String::new();
        let mut code = None;
        while let Ok(msg) = rx.recv_timeout(Duration::from_secs(15)) {
            let event: serde_json::Value = serde_json::from_str(&msg).unwrap();
            match event["type"].as_str() {
                Some("data") => output.push_str(event["data"].as_str().unwrap_or("")),
                Some("exit") => {
                    code = event["code"].as_u64();
                    break;
                }
                _ => {}
            }
        }
        assert!(output.contains("LOGSTUDIO_42"), "saída: {output}");
        assert_eq!(code, Some(3));
    }

    #[test]
    fn script_command_is_validated() {
        assert!(Agent::parse("script", None).is_err());
        assert!(Agent::parse("script", Some("   ".into())).is_err());
        assert!(Agent::parse("script", Some("a".repeat(SCRIPT_MAX + 1))).is_err());
        assert!(Agent::parse("script", Some("echo\0x".into())).is_err());
        assert!(matches!(Agent::parse("script", Some("npm run dev".into())), Ok(Agent::Script(_))));
        assert!(Agent::parse("outro", None).is_err());
    }

    #[test]
    fn utf8_split_between_reads_is_rejoined() {
        // "ção" = c3 a7 c3 a3 6f; corta no meio do segundo caractere.
        let mut pending = vec![0xc3, 0xa7, 0xc3];
        assert_eq!(take_utf8(&mut pending), "ç");
        assert_eq!(pending, vec![0xc3]);
        pending.extend_from_slice(&[0xa3, b'o']);
        assert_eq!(take_utf8(&mut pending), "ão");
        assert!(pending.is_empty());
    }
}
