mod agent_bridge;
mod attachments;
mod boards;
mod fetch;
mod filename;
mod files;
mod images;
mod portal;
mod pty;
mod settings;
mod spaces;
mod usage;
mod workspace;

use agent_bridge::Bridge;
use pty::{Agent, CanvasLink, PtyEvent, PtyManager};
use settings::Settings;
use tauri::ipc::Channel;
use spaces::SpacesInfo;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use workspace::{DropPos, Kind, Node, View};

type CmdResult<T> = Result<T, String>;

struct AppState {
    /// O Mutex também serializa as operações no disco (uma por vez).
    settings: Mutex<Settings>,
}

/// Executa `f` com a raiz dos projetos, segurando o lock durante a operação.
fn with_root<T>(state: &State<'_, AppState>, f: impl FnOnce(&Path) -> CmdResult<T>) -> CmdResult<T> {
    let guard = state
        .settings
        .lock()
        .map_err(|_| "Estado interno indisponível.".to_string())?;
    f(&guard.projects_root)
}

/// Executa `f` com o diretório do espaço de trabalho `space`.
fn with_space<T>(
    state: &State<'_, AppState>,
    space: &str,
    f: impl FnOnce(&Path) -> CmdResult<T>,
) -> CmdResult<T> {
    with_root(state, |root| f(&spaces::dir_of(root, space)?))
}

#[derive(serde::Serialize)]
struct Created {
    tree: Vec<Node>,
    id: String,
}

// ---------------- Configurações ----------------

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> CmdResult<Settings> {
    state
        .settings
        .lock()
        .map(|s| s.clone())
        .map_err(|_| "Estado interno indisponível.".to_string())
}

#[tauri::command(async)]
fn set_projects_root(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<Settings> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err("Escolha um caminho absoluto.".into());
    }
    std::fs::create_dir_all(&path).map_err(|e| format!("Não foi possível criar o diretório: {e}"))?;

    let mut guard = state
        .settings
        .lock()
        .map_err(|_| "Estado interno indisponível.".to_string())?;
    let next = Settings { projects_root: path };
    settings::save(&app, &next)?;
    *guard = next.clone();
    Ok(next)
}

// ---------------- Espaços de trabalho ----------------

#[tauri::command(async)]
fn list_spaces(state: State<'_, AppState>) -> CmdResult<SpacesInfo> {
    with_root(&state, spaces::info)
}

#[tauri::command(async)]
fn create_space(state: State<'_, AppState>, name: String) -> CmdResult<SpacesInfo> {
    with_root(&state, |root| spaces::create(root, &name))
}

#[tauri::command(async)]
fn select_space(state: State<'_, AppState>, name: String) -> CmdResult<()> {
    with_root(&state, |root| spaces::select(root, &name))
}

#[tauri::command(async)]
fn rename_space(state: State<'_, AppState>, old_name: String, new_name: String) -> CmdResult<SpacesInfo> {
    with_root(&state, |root| spaces::rename(root, &old_name, &new_name))
}

#[tauri::command(async)]
fn delete_space(state: State<'_, AppState>, name: String) -> CmdResult<SpacesInfo> {
    with_root(&state, |root| spaces::delete(root, &name))
}

// ---------------- Árvore de pastas/projetos (dentro de um espaço) ----------------

#[tauri::command(async)]
fn load_tree(state: State<'_, AppState>, space: String) -> CmdResult<Vec<Node>> {
    with_space(&state, &space, workspace::load)
}

#[tauri::command(async)]
fn create_folder(state: State<'_, AppState>, space: String, parent: Option<String>) -> CmdResult<Created> {
    with_space(&state, &space, |dir| workspace::create(dir, parent.as_deref(), Kind::Folder))
        .map(|(tree, id)| Created { tree, id })
}

#[tauri::command(async)]
fn create_project(state: State<'_, AppState>, space: String, parent: Option<String>) -> CmdResult<Created> {
    with_space(&state, &space, |dir| workspace::create(dir, parent.as_deref(), Kind::Project))
        .map(|(tree, id)| Created { tree, id })
}

#[tauri::command(async)]
fn rename_node(state: State<'_, AppState>, space: String, id: String, name: String) -> CmdResult<Vec<Node>> {
    with_space(&state, &space, |dir| workspace::rename(dir, &id, &name))
}

#[tauri::command(async)]
fn delete_node(state: State<'_, AppState>, space: String, id: String) -> CmdResult<Vec<Node>> {
    with_space(&state, &space, |dir| workspace::delete(dir, &id))
}

#[tauri::command(async)]
fn move_node(
    state: State<'_, AppState>,
    space: String,
    drag_id: String,
    target_id: Option<String>,
    pos: DropPos,
) -> CmdResult<Vec<Node>> {
    with_space(&state, &space, |dir| {
        workspace::move_node(dir, &drag_id, target_id.as_deref(), pos)
    })
}

#[tauri::command(async)]
fn set_expanded(state: State<'_, AppState>, space: String, id: String, expanded: bool) -> CmdResult<()> {
    with_space(&state, &space, |dir| workspace::set_expanded(dir, &id, expanded))
}

#[tauri::command(async)]
fn set_active_project(state: State<'_, AppState>, space: String, id: Option<String>) -> CmdResult<()> {
    with_space(&state, &space, |dir| workspace::set_active(dir, id.as_deref()))
}

#[tauri::command(async)]
fn save_project_view(state: State<'_, AppState>, space: String, id: String, view: View) -> CmdResult<()> {
    with_space(&state, &space, |dir| workspace::save_view(dir, &id, view))
}

#[tauri::command(async)]
fn save_project_canvas(
    state: State<'_, AppState>,
    space: String,
    id: String,
    nodes: serde_json::Value,
) -> CmdResult<()> {
    with_space(&state, &space, |dir| workspace::save_canvas(dir, &id, nodes))
}

// ---------------- Fontes do sistema ----------------

/// Nomes das famílias de fontes instaladas (para o seletor de fonte das notas).
#[tauri::command(async)]
fn list_fonts() -> Vec<String> {
    #[cfg(windows)]
    {
        let mut names: Vec<String> = dwrote::FontCollection::system()
            .families_iter()
            .filter_map(|family| family.family_name().ok())
            .filter(|name| !name.is_empty() && !name.starts_with('@')) // '@' = variantes verticais
            .collect();
        names.sort_by_key(|n| n.to_lowercase());
        names.dedup();
        names
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

// ---------------- Terminais (PTY) ----------------

/// Inicia (ou reinicia) o terminal `id` no diretório do projeto `project`.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
fn pty_spawn(
    state: State<'_, AppState>,
    ptys: State<'_, PtyManager>,
    bridge: State<'_, BridgeState>,
    id: String,
    space: String,
    project: String,
    agent: String,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> CmdResult<()> {
    let agent = Agent::parse(&agent)?;
    // O diretório vem da árvore real do espaço (nunca de um caminho enviado pelo frontend).
    let cwd = with_space(&state, &space, |dir| workspace::path_of(dir, &project))?;
    // Claude Code: liga o agente ao canvas do projeto (ferramentas MCP).
    let link = match (&agent, bridge.0.as_ref()) {
        (Agent::Claude, Some(b)) => match b.register(&id, &space, &project) {
            Ok((mcp_config, token)) => Some(CanvasLink {
                mcp_config,
                url: b.url(),
                token,
                terminal_id: id.clone(),
            }),
            Err(e) => {
                eprintln!("{e}");
                None
            }
        },
        _ => None,
    };
    ptys.spawn(id, agent, &cwd, cols, rows, on_event, link)
}

/// Agente: imagem a partir de um caminho (absoluto ou relativo ao projeto) ou URL http(s).
#[tauri::command(async)]
fn agent_import_image(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    source: String,
) -> CmdResult<String> {
    let dir = project_dir(&state, &space, &project_id)?;
    match fetch::resolve(&dir, &source)? {
        fetch::Source::Path(p) => images::import(&dir, &p),
        fetch::Source::Url(url) => {
            let (bytes, name) = fetch::download(&url, images::MAX_BYTES as u64)?;
            images::save(&dir, &bytes, Some(&name).filter(|n| !n.is_empty()).map(String::as_str))
        }
    }
}

/// Agente: anexo a partir de um caminho (absoluto ou relativo ao projeto) ou URL http(s).
#[tauri::command(async)]
fn agent_attach_file(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    source: String,
) -> CmdResult<attachments::Attached> {
    let dir = project_dir(&state, &space, &project_id)?;
    match fetch::resolve(&dir, &source)? {
        fetch::Source::Path(p) => attachments::import(&dir, &p),
        fetch::Source::Url(url) => {
            let (bytes, name) = fetch::download(&url, attachments::MAX_BYTES)?;
            attachments::save(&dir, if name.is_empty() { "arquivo" } else { &name }, &bytes)
        }
    }
}

// ---------------- Quadros (Excalidraw) ----------------

#[tauri::command(async)]
fn board_load(state: State<'_, AppState>, space: String, project_id: String, id: String) -> CmdResult<Option<String>> {
    let dir = project_dir(&state, &space, &project_id)?;
    boards::load(&dir, &id)
}

#[tauri::command(async)]
fn board_save(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    id: String,
    content: String,
) -> CmdResult<()> {
    let dir = project_dir(&state, &space, &project_id)?;
    boards::save(&dir, &id, &content)
}

#[tauri::command(async)]
fn board_delete(state: State<'_, AppState>, space: String, project_id: String, id: String) -> CmdResult<()> {
    let dir = project_dir(&state, &space, &project_id)?;
    boards::remove(&dir, &id)
}

/// Ponte do agente (None se o servidor local não subiu).
struct BridgeState(Option<Arc<Bridge>>);

/// Resposta do canvas a um pedido do agente.
#[tauri::command]
fn agent_reply(bridge: State<'_, BridgeState>, req_id: u64, ok: bool, result: serde_json::Value) {
    if let Some(b) = bridge.0.as_ref() {
        b.reply(req_id, ok, result);
    }
}

#[tauri::command]
fn pty_write(ptys: State<'_, PtyManager>, id: String, data: String) -> CmdResult<()> {
    ptys.write(&id, &data)
}

#[tauri::command]
fn pty_resize(ptys: State<'_, PtyManager>, id: String, cols: u16, rows: u16) -> CmdResult<()> {
    ptys.resize(&id, cols, rows)
}

#[tauri::command]
fn pty_kill(ptys: State<'_, PtyManager>, bridge: State<'_, BridgeState>, id: String) {
    ptys.kill(&id);
    if let Some(b) = bridge.0.as_ref() {
        b.unregister(&id);
    }
}

/// Encerra todos os terminais (o frontend chama ao iniciar, para limpar órfãos de um recarregamento).
#[tauri::command]
fn pty_kill_all(ptys: State<'_, PtyManager>, bridge: State<'_, BridgeState>) {
    ptys.kill_all();
    if let Some(b) = bridge.0.as_ref() {
        b.unregister_all();
    }
}

#[tauri::command(async)]
fn open_in_explorer(app: AppHandle, state: State<'_, AppState>, space: String, id: String) -> CmdResult<()> {
    let path = with_space(&state, &space, |dir| workspace::path_of(dir, &id))?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Não foi possível abrir no Explorer: {e}"))
}

// ---------------- Imagens do canvas ----------------

/// Diretório de um projeto (o lock é liberado antes de mexer nos arquivos).
fn project_dir(state: &State<'_, AppState>, space: &str, project_id: &str) -> CmdResult<PathBuf> {
    with_space(state, space, |dir| workspace::path_of(dir, project_id))
}

/// Decodifica "%XX" (os cabeçalhos HTTP só aceitam ASCII; o frontend usa encodeURIComponent).
pub(crate) fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> CmdResult<String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decode)
        .ok_or_else(|| format!("Cabeçalho {name} ausente."))
}

/// Imagem colada: corpo = bytes da imagem; cabeçalhos x-space / x-project
/// e x-name (opcional: nome original, usado no nome do arquivo salvo).
#[tauri::command]
fn save_canvas_image(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Imagem inválida.".into());
    };
    let dir = project_dir(&state, &header(&request, "x-space")?, &header(&request, "x-project")?)?;
    let name = header(&request, "x-name").ok();
    images::save(&dir, bytes, name.as_deref())
}

/// Imagens arrastadas do Explorer: copia cada uma para o projeto.
/// Ignora o que não for imagem; erro só se nenhuma der certo.
#[tauri::command(async)]
fn import_canvas_images(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    paths: Vec<String>,
) -> CmdResult<Vec<String>> {
    let dir = project_dir(&state, &space, &project_id)?;
    let mut names = Vec::new();
    let mut first_err = None;
    for p in paths.iter().map(Path::new).filter(|p| images::is_image_path(p)) {
        match images::import(&dir, p) {
            Ok(name) => names.push(name),
            Err(e) => {
                first_err.get_or_insert(e);
            }
        }
    }
    match (names.is_empty(), first_err) {
        (true, Some(e)) => Err(e),
        _ => Ok(names),
    }
}

#[tauri::command(async)]
fn read_canvas_image(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    file: String,
) -> CmdResult<tauri::ipc::Response> {
    let dir = project_dir(&state, &space, &project_id)?;
    images::read(&dir, &file).map(tauri::ipc::Response::new)
}

#[tauri::command(async)]
fn delete_canvas_image(state: State<'_, AppState>, space: String, project_id: String, file: String) -> CmdResult<()> {
    let dir = project_dir(&state, &space, &project_id)?;
    images::remove(&dir, &file)
}

// ---------------- Navegador de arquivos ("Pasta") ----------------
// Caminhos sempre relativos ao diretório do projeto (validados em files::resolve).

#[tauri::command(async)]
fn fs_list(state: State<'_, AppState>, space: String, project_id: String, rel: String) -> CmdResult<Vec<files::Entry>> {
    let dir = project_dir(&state, &space, &project_id)?;
    files::list(&dir, &rel)
}

#[tauri::command(async)]
fn fs_read_text(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    rel: String,
) -> CmdResult<files::TextFile> {
    let dir = project_dir(&state, &space, &project_id)?;
    files::read_text(&dir, &rel)
}

#[tauri::command(async)]
fn fs_read_bytes(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    rel: String,
) -> CmdResult<tauri::ipc::Response> {
    let dir = project_dir(&state, &space, &project_id)?;
    files::read_bytes(&dir, &rel).map(tauri::ipc::Response::new)
}

#[tauri::command(async)]
fn fs_write_text(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    rel: String,
    content: String,
) -> CmdResult<()> {
    let dir = project_dir(&state, &space, &project_id)?;
    files::write_text(&dir, &rel, &content)
}

#[tauri::command(async)]
fn fs_create(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    dir: String,
    name: String,
    is_dir: bool,
) -> CmdResult<String> {
    let root = project_dir(&state, &space, &project_id)?;
    files::create(&root, &dir, &name, is_dir)
}

#[tauri::command(async)]
fn fs_move(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    from: String,
    to_dir: String,
) -> CmdResult<String> {
    let root = project_dir(&state, &space, &project_id)?;
    files::move_item(&root, &from, &to_dir)
}

#[tauri::command(async)]
fn fs_search(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    query: String,
) -> CmdResult<Vec<files::SearchHit>> {
    let dir = project_dir(&state, &space, &project_id)?;
    files::search(&dir, &query)
}

// ---------------- Portal (página web no canvas) ----------------

/// Diz se o site bloqueia ser mostrado dentro do app (iframe).
#[tauri::command(async)]
fn portal_check(url: String) -> CmdResult<portal::FrameCheck> {
    portal::check(&url)
}

// ---------------- Anexos (qualquer arquivo no canvas) ----------------

/// Arquivos escolhidos no seletor ou arrastados do Explorer: copia cada um para os anexos.
/// Ignora os que falharem; erro só se nenhum der certo.
#[tauri::command(async)]
fn import_attachments(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    paths: Vec<String>,
) -> CmdResult<Vec<attachments::Attached>> {
    let dir = project_dir(&state, &space, &project_id)?;
    let mut out = Vec::new();
    let mut first_err = None;
    for p in &paths {
        match attachments::import(&dir, Path::new(p)) {
            Ok(a) => out.push(a),
            Err(e) => {
                first_err.get_or_insert(e);
            }
        }
    }
    match (out.is_empty(), first_err) {
        (true, Some(e)) => Err(e),
        _ => Ok(out),
    }
}

/// Arquivo colado (Ctrl+V): corpo = bytes; cabeçalhos x-space / x-project / x-name.
#[tauri::command]
fn save_attachment(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<attachments::Attached> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Arquivo inválido.".into());
    };
    let dir = project_dir(&state, &header(&request, "x-space")?, &header(&request, "x-project")?)?;
    attachments::save(&dir, &header(&request, "x-name")?, bytes)
}

/// Caminho do anexo para o protocolo de assets (PDF/vídeo/áudio). Libera só esse arquivo.
#[tauri::command(async)]
fn attachment_src(
    app: AppHandle,
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    file: String,
) -> CmdResult<String> {
    let dir = project_dir(&state, &space, &project_id)?;
    let path = attachments::path(&dir, &file)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| format!("Não foi possível liberar o anexo: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Texto de um anexo (prévia de texto/código; até 5 MB).
#[tauri::command(async)]
fn attachment_read_text(
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    file: String,
) -> CmdResult<files::TextFile> {
    let dir = project_dir(&state, &space, &project_id)?;
    attachments::path(&dir, &file)?;
    files::read_text(&attachments::dir(&dir), &file)
}

/// Abre o anexo no app padrão do Windows (nunca executáveis/scripts).
#[tauri::command(async)]
fn open_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    file: String,
) -> CmdResult<()> {
    if attachments::is_dangerous(&file) {
        return Err("Por segurança, executáveis e scripts não são abertos pelo app.".into());
    }
    let dir = project_dir(&state, &space, &project_id)?;
    let path = attachments::path(&dir, &file)?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Não foi possível abrir: {e}"))
}

/// Mostra o anexo selecionado no Explorer.
#[tauri::command(async)]
fn reveal_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    space: String,
    project_id: String,
    file: String,
) -> CmdResult<()> {
    let dir = project_dir(&state, &space, &project_id)?;
    let path = attachments::path(&dir, &file)?;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Não foi possível mostrar no Explorer: {e}"))
}

#[tauri::command(async)]
fn delete_attachment(state: State<'_, AppState>, space: String, project_id: String, file: String) -> CmdResult<()> {
    let dir = project_dir(&state, &space, &project_id)?;
    attachments::remove(&dir, &file)
}

// ---------------- Uso do plano dos agentes ----------------

/// Limites de uso (5h, semanal, por modelo) do agente, pedidos ao próprio CLI (~1–5 s).
#[tauri::command(async)]
fn agent_usage(agent: String) -> usage::Report {
    usage::report(&agent)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let settings = settings::load(app.handle());
            let _ = std::fs::create_dir_all(&settings.projects_root);
            app.manage(AppState {
                settings: Mutex::new(settings),
            });
            app.manage(PtyManager::default());
            let bridge = Bridge::start(app.handle().clone())
                .map_err(|e| eprintln!("{e}"))
                .ok();
            app.manage(BridgeState(bridge));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_projects_root,
            list_spaces,
            create_space,
            select_space,
            rename_space,
            delete_space,
            load_tree,
            create_folder,
            create_project,
            rename_node,
            delete_node,
            move_node,
            set_expanded,
            set_active_project,
            save_project_view,
            save_project_canvas,
            list_fonts,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_kill_all,
            open_in_explorer,
            agent_reply,
            board_load,
            board_save,
            board_delete,
            agent_import_image,
            agent_attach_file,
            save_canvas_image,
            import_canvas_images,
            read_canvas_image,
            delete_canvas_image,
            fs_list,
            fs_read_text,
            fs_read_bytes,
            fs_write_text,
            fs_search,
            fs_create,
            fs_move,
            portal_check,
            import_attachments,
            save_attachment,
            attachment_src,
            attachment_read_text,
            open_attachment,
            reveal_attachment,
            delete_attachment,
            agent_usage,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Ao fechar o app, encerra todos os terminais.
            if let tauri::RunEvent::Exit = event {
                app.state::<PtyManager>().kill_all();
                if let Some(b) = app.state::<BridgeState>().0.as_ref() {
                    b.unregister_all();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_percent_headers() {
        assert_eq!(super::percent_decode("Espa%C3%A7o%20A").as_deref(), Some("Espaço A"));
        assert_eq!(super::percent_decode("a%2Fb").as_deref(), Some("a/b"));
        assert_eq!(super::percent_decode("%ZZ"), None);
    }

    #[test]
    fn lists_installed_fonts() {
        let fonts = super::list_fonts();
        println!("{} fontes; ex.: {:?}", fonts.len(), &fonts[..fonts.len().min(5)]);
        assert!(fonts.iter().any(|f| f == "Consolas" || f == "Arial"), "{fonts:?}");
    }
}
