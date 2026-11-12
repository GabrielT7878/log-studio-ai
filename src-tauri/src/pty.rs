//! Terminais de verdade (ConPTY no Windows) para os cards do canvas.
//!
//! - Cada sessão tem um `id` (o id do card no frontend).
//! - O comando é escolhido aqui a partir de uma lista fixa (`Agent`); o frontend
//!   nunca manda um comando arbitrário.
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

/// O que roda no terminal (lista fixa).
#[derive(Clone, Copy, Debug)]
pub enum Agent {
    Shell,
    Claude,
    Codex,
}

impl Agent {
    pub fn parse(s: &str) -> Res<Self> {
        match s {
            "shell" => Ok(Agent::Shell),
            "claude" => Ok(Agent::Claude),
            "codex" => Ok(Agent::Codex),
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

fn command_for(agent: Agent, cwd: &Path, link: Option<&CanvasLink>) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.arg("-NoLogo");
    let program = match agent {
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
            .spawn_command(command_for(agent, cwd, link.as_ref()))
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
