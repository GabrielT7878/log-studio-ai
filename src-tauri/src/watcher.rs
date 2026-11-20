// Observa pastas do disco para a janela "Pasta": quando algo muda (arquivo criado, apagado,
// renomeado ou alterado por terminal, agente ou Explorer), avisa o frontend com o evento
// `fs-changed` levando a chave da inscrição. Uma pasta por inscrição, sem subpastas
// (a lista da janela só mostra o conteúdo direto da pasta aberta).

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

type Res<T> = Result<T, String>;

/// Nome do evento enviado ao frontend (payload: a chave da inscrição).
pub const EVENT: &str = "fs-changed";

/// Espera para juntar uma rajada de mudanças (ex.: `git checkout`) num aviso só.
const DEBOUNCE: Duration = Duration::from_millis(200);

/// Inscrições ativas: chave (gerada pelo frontend) → watcher. Soltar o watcher para de observar.
#[derive(Default)]
pub struct Watches(Mutex<HashMap<String, RecommendedWatcher>>);

/// A mudança é só na pasta interna do app (`.logstudio`), que a lista não mostra?
fn only_internal(event: &Event) -> bool {
    !event.paths.is_empty()
        && event
            .paths
            .iter()
            .all(|p| p.file_name().is_some_and(|n| n == ".logstudio"))
}

impl Watches {
    /// Começa a observar `dir` (troca a inscrição se a chave já existir).
    pub fn watch(&self, app: AppHandle, key: String, dir: &Path) -> Res<()> {
        let pending = Arc::new(AtomicBool::new(false));
        let emit_key = key.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            if event.kind.is_access() || only_internal(&event) {
                return;
            }
            // Já tem um aviso agendado: esta mudança entra nele.
            if pending.swap(true, Ordering::SeqCst) {
                return;
            }
            let (app, key, pending) = (app.clone(), emit_key.clone(), pending.clone());
            std::thread::spawn(move || {
                std::thread::sleep(DEBOUNCE);
                pending.store(false, Ordering::SeqCst);
                let _ = app.emit(EVENT, key);
            });
        })
        .map_err(|e| format!("Não foi possível observar a pasta: {e}"))?;
        watcher
            .watch(dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Não foi possível observar a pasta: {e}"))?;
        self.0
            .lock()
            .map_err(|_| "Estado interno indisponível.".to_string())?
            .insert(key, watcher);
        Ok(())
    }

    /// Para de observar (chave desconhecida: nada a fazer).
    pub fn unwatch(&self, key: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.remove(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, EventKind};
    use std::path::PathBuf;

    fn event(paths: &[&str]) -> Event {
        let mut e = Event::new(EventKind::Create(CreateKind::File));
        e.paths = paths.iter().map(PathBuf::from).collect();
        e
    }

    #[test]
    fn ignora_so_a_pasta_interna() {
        assert!(only_internal(&event(&["C:/p/.logstudio"])));
        assert!(!only_internal(&event(&["C:/p/novo.txt"])));
        assert!(!only_internal(&event(&["C:/p/.logstudio", "C:/p/novo.txt"])));
        assert!(!only_internal(&event(&[])));
    }
}
