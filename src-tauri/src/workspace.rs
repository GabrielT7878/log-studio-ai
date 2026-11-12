//! Árvore de pastas e projetos no disco.
//!
//! - Pastas e projetos são diretórios reais dentro da raiz (`projects_root`).
//! - Ordem, tipo (pasta/projeto), cor e "aberta/fechada" ficam em `<raiz>/.logstudio.json`.
//! - O disco é a fonte de verdade: diretórios criados por fora entram como projetos
//!   e os apagados por fora somem da árvore.
//! - O `id` de cada item é o seu caminho relativo à raiz, com `/` (ex.: "Pasta/Projeto").
//!   Toda operação localiza o item na árvore carregada do disco, então um id
//!   inválido (ou com `..`) nunca vira caminho.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const META_FILE: &str = ".logstudio.json";
const META_VERSION: u32 = 1;
const DEFAULT_FOLDER_NAME: &str = "Nova pasta";
const DEFAULT_PROJECT_NAME: &str = "Novo projeto";
const MAX_NAME_LEN: usize = 120;
const PALETTE: [&str; 7] = [
    "#6fcf73", "#60a5fa", "#a78bfa", "#f59e5b", "#f472b6", "#5ec8d8", "#f5c542",
];

type Res<T> = Result<T, String>;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Folder,
    Project,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum DropPos {
    Before,
    After,
    Inside,
}

/// Posição e zoom do canvas de um projeto (e a janela em tela cheia, se houver).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct View {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
    /// Id da janela do canvas em tela cheia (projetos antigos não têm o campo).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fullscreen: Option<String>,
}

/// Item da árvore enviado ao frontend.
#[derive(Serialize, Clone, Debug)]
pub struct Node {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub expanded: bool,
    pub children: Vec<Node>,
    /// Projeto aberto no canvas (no máximo um por espaço).
    #[serde(skip_serializing_if = "is_false")]
    pub active: bool,
    /// Posição/zoom salvos do canvas do projeto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view: Option<View>,
    /// Cards do canvas do projeto (terminais etc.). Formato definido pelo frontend.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas: Option<serde_json::Value>,
}

/// Conteúdo do `.logstudio.json`.
#[derive(Serialize, Deserialize, Default)]
struct Meta {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    nodes: Vec<MetaNode>,
}

#[derive(Serialize, Deserialize, Clone)]
struct MetaNode {
    name: String,
    kind: Kind,
    #[serde(default, skip_serializing_if = "is_false")]
    expanded: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    children: Vec<MetaNode>,
    #[serde(default, skip_serializing_if = "is_false")]
    active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    view: Option<View>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    canvas: Option<serde_json::Value>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

// ---------------------------------------------------------------------------
// Leitura / escrita
// ---------------------------------------------------------------------------

/// Carrega a árvore da raiz (criando a raiz se não existir).
pub fn load(root: &Path) -> Res<Vec<Node>> {
    fs::create_dir_all(root)
        .map_err(|e| format!("Não foi possível criar {}: {e}", root.display()))?;
    let meta = read_meta(root);
    let mut nodes = build(root, &meta.nodes);
    assign_ids(&mut nodes, "");
    Ok(nodes)
}

fn read_meta(root: &Path) -> Meta {
    fs::read_to_string(root.join(META_FILE))
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn save(root: &Path, nodes: &[Node]) -> Res<()> {
    let meta = Meta {
        version: META_VERSION,
        nodes: to_meta(nodes),
    };
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    // Escreve num temporário e troca, para não corromper o arquivo se algo falhar.
    let tmp = root.join(format!("{META_FILE}.tmp"));
    fs::write(&tmp, json).map_err(|e| format!("Não foi possível salvar {META_FILE}: {e}"))?;
    fs::rename(&tmp, root.join(META_FILE))
        .map_err(|e| format!("Não foi possível salvar {META_FILE}: {e}"))
}

fn to_meta(nodes: &[Node]) -> Vec<MetaNode> {
    nodes
        .iter()
        .map(|n| MetaNode {
            name: n.name.clone(),
            kind: n.kind,
            expanded: n.expanded,
            color: n.color.clone(),
            children: to_meta(&n.children),
            active: n.active,
            view: n.view.clone(),
            canvas: n.canvas.clone(),
        })
        .collect()
}

/// Subdiretórios visíveis (ignora arquivos e nomes começando com ".").
pub(crate) fn list_dirs(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))
        .collect()
}

pub(crate) fn same_name(a: &str, b: &str) -> bool {
    a == b || a.to_lowercase() == b.to_lowercase()
}

/// Junta o que está no disco com a ordem/tipos salvos no metadado.
fn build(dir: &Path, meta: &[MetaNode]) -> Vec<Node> {
    let mut remaining = list_dirs(dir);
    let mut out = Vec::new();

    // 1) Itens conhecidos, na ordem salva (só os que ainda existem no disco).
    for m in meta {
        if let Some(pos) = remaining.iter().position(|n| same_name(n, &m.name)) {
            let name = remaining.remove(pos);
            out.push(make_node(dir, name, m.kind, Some(m)));
        }
    }

    // 2) Diretórios novos (criados por fora do app) entram como projetos, em ordem alfabética.
    remaining.sort_by_key(|n| n.to_lowercase());
    out.extend(
        remaining
            .into_iter()
            .map(|name| make_node(dir, name, Kind::Project, None)),
    );
    out
}

/// Monta um nó a partir do disco + metadado salvo (quando houver).
fn make_node(dir: &Path, name: String, kind: Kind, meta: Option<&MetaNode>) -> Node {
    match kind {
        Kind::Folder => {
            let meta_children = meta.map_or(&[][..], |m| &m.children);
            Node {
                id: String::new(),
                kind,
                color: None,
                expanded: meta.is_some_and(|m| m.expanded),
                children: build(&dir.join(&name), meta_children),
                active: false,
                view: None,
                canvas: None,
                name,
            }
        }
        Kind::Project => Node {
            id: String::new(),
            kind,
            color: Some(
                meta.and_then(|m| m.color.clone())
                    .unwrap_or_else(|| color_from_name(&name)),
            ),
            expanded: false,
            children: Vec::new(),
            active: meta.is_some_and(|m| m.active),
            view: meta.and_then(|m| m.view.clone()),
            canvas: meta.and_then(|m| m.canvas.clone()),
            name,
        },
    }
}

fn assign_ids(nodes: &mut [Node], prefix: &str) {
    for n in nodes {
        n.id = if prefix.is_empty() { n.name.clone() } else { format!("{prefix}/{}", n.name) };
        let id = n.id.clone();
        assign_ids(&mut n.children, &id);
    }
}

fn color_from_name(name: &str) -> String {
    let h = name.bytes().fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32));
    PALETTE[h as usize % PALETTE.len()].to_string()
}

fn random_color() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    PALETTE[nanos as usize % PALETTE.len()].to_string()
}

// ---------------------------------------------------------------------------
// Navegação pela árvore (por id = caminho relativo)
// ---------------------------------------------------------------------------

/// Separa "a/b/c" em (Some("a/b"), "c").
fn split_id(id: &str) -> (Option<&str>, &str) {
    match id.rsplit_once('/') {
        Some((parent, name)) => (Some(parent), name),
        None => (None, id),
    }
}

fn abs_path(root: &Path, id: &str) -> PathBuf {
    id.split('/').fold(root.to_path_buf(), |p, seg| p.join(seg))
}

fn find<'a>(nodes: &'a [Node], id: &str) -> Option<&'a Node> {
    let mut list = nodes;
    let mut segs = id.split('/').peekable();
    loop {
        let seg = segs.next()?;
        let node = list.iter().find(|n| n.name == seg)?;
        if segs.peek().is_none() {
            return Some(node);
        }
        list = &node.children;
    }
}

fn find_mut<'a>(nodes: &'a mut Vec<Node>, id: &str) -> Option<&'a mut Node> {
    let mut list = nodes;
    let mut segs = id.split('/').peekable();
    loop {
        let seg = segs.next()?;
        let node = list.iter_mut().find(|n| n.name == seg)?;
        if segs.peek().is_none() {
            return Some(node);
        }
        list = &mut node.children;
    }
}

/// Lista de filhos da pasta `parent` (ou a raiz quando `None`).
fn children_mut<'a>(nodes: &'a mut Vec<Node>, parent: Option<&str>) -> Option<&'a mut Vec<Node>> {
    match parent {
        None => Some(nodes),
        Some(p) => {
            let node = find_mut(nodes, p)?;
            (node.kind == Kind::Folder).then_some(&mut node.children)
        }
    }
}

fn remove(nodes: &mut Vec<Node>, id: &str) -> Option<Node> {
    let (parent, name) = split_id(id);
    let list = children_mut(nodes, parent)?;
    let idx = list.iter().position(|n| n.name == name)?;
    Some(list.remove(idx))
}

pub(crate) fn unique_name(dir: &Path, base: &str) -> String {
    if !dir.join(base).exists() {
        return base.to_string();
    }
    (2..)
        .map(|i| format!("{base} ({i})"))
        .find(|name| !dir.join(name).exists())
        .expect("sempre existe um nome livre")
}

/// Valida um nome de diretório no Windows. Devolve o nome sem espaços nas pontas.
pub fn validate_name(raw: &str) -> Res<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("O nome não pode ficar vazio.".into());
    }
    if name
        .chars()
        .any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control())
    {
        return Err("O nome não pode conter \\ / : * ? \" < > |".into());
    }
    if name.starts_with('.') {
        return Err("O nome não pode começar com ponto.".into());
    }
    if name.ends_with('.') {
        return Err("O nome não pode terminar com ponto.".into());
    }
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let numbered = (stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem.len() == 4
        && matches!(stem.as_bytes()[3], b'1'..=b'9');
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || numbered {
        return Err(format!("“{name}” é um nome reservado do Windows."));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(format!("O nome é muito longo (máx. {MAX_NAME_LEN} caracteres)."));
    }
    Ok(name.to_string())
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

/// Cria uma pasta ou projeto dentro de `parent` (ou na raiz). Devolve a árvore e o id novo.
pub fn create(root: &Path, parent: Option<&str>, kind: Kind) -> Res<(Vec<Node>, String)> {
    let mut nodes = load(root)?;
    let parent_dir = match parent {
        None => root.to_path_buf(),
        Some(p) => match find(&nodes, p) {
            Some(n) if n.kind == Kind::Folder => abs_path(root, p),
            _ => return Err("Pasta não encontrada.".into()),
        },
    };

    let base = match kind {
        Kind::Folder => DEFAULT_FOLDER_NAME,
        Kind::Project => DEFAULT_PROJECT_NAME,
    };
    let name = unique_name(&parent_dir, base);
    fs::create_dir(parent_dir.join(&name))
        .map_err(|e| format!("Não foi possível criar “{name}”: {e}"))?;

    let mut node = make_node(&parent_dir, name.clone(), kind, None);
    if kind == Kind::Project {
        node.color = Some(random_color());
    }
    children_mut(&mut nodes, parent)
        .ok_or("Pasta não encontrada.")?
        .push(node);
    // Abre a pasta de destino para o item novo aparecer.
    if let Some(p) = parent {
        if let Some(folder) = find_mut(&mut nodes, p) {
            folder.expanded = true;
        }
    }

    assign_ids(&mut nodes, "");
    save(root, &nodes)?;
    let id = match parent {
        Some(p) => format!("{p}/{name}"),
        None => name,
    };
    Ok((nodes, id))
}

/// Renomeia o diretório do item.
pub fn rename(root: &Path, id: &str, new_name: &str) -> Res<Vec<Node>> {
    let new_name = validate_name(new_name)?;
    let mut nodes = load(root)?;
    let current = find(&nodes, id).ok_or("Item não encontrado.")?.name.clone();
    if current == new_name {
        return Ok(nodes);
    }

    let src = abs_path(root, id);
    let dst = src.with_file_name(&new_name);
    // Só mudar maiúsculas/minúsculas é permitido (no Windows o destino "já existe").
    if dst.exists() && !same_name(&current, &new_name) {
        return Err(format!("Já existe um item chamado “{new_name}” aqui."));
    }
    fs::rename(&src, &dst).map_err(|e| format!("Não foi possível renomear: {e}"))?;

    if let Some(node) = find_mut(&mut nodes, id) {
        node.name = new_name;
    }
    assign_ids(&mut nodes, "");
    save(root, &nodes)?;
    Ok(nodes)
}

/// Manda uma pasta para a Lixeira. Se ela estiver em uso (o Windows demora alguns ms para
/// soltar a pasta depois que um processo que rodava nela termina), tenta de novo algumas vezes.
pub fn trash_dir(path: &Path) -> Res<()> {
    const ATTEMPTS: u32 = 5;
    let mut last = String::new();
    for attempt in 1..=ATTEMPTS {
        match trash::delete(path) {
            Ok(()) => return Ok(()),
            Err(e) => last = e.to_string(),
        }
        if !path.exists() {
            return Ok(());
        }
        if attempt < ATTEMPTS {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }
    if is_in_use(&last) {
        Err("A pasta está em uso por outro programa (Explorer, editor, terminal…). Feche-o e tente de novo.".into())
    } else {
        Err(format!("Não foi possível mover para a Lixeira: {last}"))
    }
}

/// Erro do Windows "em uso por outro processo" (0x80270028 / 0x80070020).
fn is_in_use(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("0x80270028") || m.contains("0x80070020") || m.contains("in use") || m.contains("em uso")
}

/// Move o diretório do item para a Lixeira.
pub fn delete(root: &Path, id: &str) -> Res<Vec<Node>> {
    let mut nodes = load(root)?;
    find(&nodes, id).ok_or("Item não encontrado.")?;
    let path = abs_path(root, id);
    trash_dir(&path)?;

    remove(&mut nodes, id);
    assign_ids(&mut nodes, "");
    save(root, &nodes)?;
    Ok(nodes)
}

/// Reordena e/ou muda o item de pasta (movendo o diretório quando a pasta muda).
pub fn move_node(root: &Path, drag_id: &str, target_id: Option<&str>, pos: DropPos) -> Res<Vec<Node>> {
    let mut nodes = load(root)?;
    let drag_name = find(&nodes, drag_id).ok_or("Item não encontrado.")?.name.clone();

    // Pasta de destino (None = raiz).
    let new_parent: Option<String> = match target_id {
        None => None,
        Some(t) => {
            if t == drag_id {
                return Ok(nodes);
            }
            if t.starts_with(&format!("{drag_id}/")) {
                return Err("Não é possível mover uma pasta para dentro dela mesma.".into());
            }
            let target = find(&nodes, t).ok_or("Destino não encontrado.")?;
            match pos {
                DropPos::Inside if target.kind == Kind::Folder => Some(t.to_string()),
                DropPos::Inside => return Err("Destino inválido.".into()),
                DropPos::Before | DropPos::After => split_id(t).0.map(str::to_string),
            }
        }
    };

    // Mudou de pasta → move o diretório no disco.
    let old_parent = split_id(drag_id).0.map(str::to_string);
    if new_parent != old_parent {
        let dst_dir = match &new_parent {
            Some(p) => abs_path(root, p),
            None => root.to_path_buf(),
        };
        let dst = dst_dir.join(&drag_name);
        if dst.exists() {
            return Err(format!("Já existe um item chamado “{drag_name}” no destino."));
        }
        fs::rename(abs_path(root, drag_id), &dst).map_err(|e| format!("Não foi possível mover: {e}"))?;
    }

    // Atualiza a ordem na árvore.
    let node = remove(&mut nodes, drag_id).ok_or("Item não encontrado.")?;
    let list = children_mut(&mut nodes, new_parent.as_deref()).ok_or("Destino não encontrado.")?;
    match (target_id, pos) {
        (Some(t), DropPos::Before | DropPos::After) => {
            let target_name = split_id(t).1;
            let idx = list
                .iter()
                .position(|n| n.name == target_name)
                .map(|i| if pos == DropPos::After { i + 1 } else { i })
                .unwrap_or(list.len());
            list.insert(idx, node);
        }
        _ => list.push(node),
    }

    assign_ids(&mut nodes, "");
    save(root, &nodes)?;
    Ok(nodes)
}

/// Salva se a pasta está aberta ou fechada.
pub fn set_expanded(root: &Path, id: &str, expanded: bool) -> Res<()> {
    let mut nodes = load(root)?;
    if let Some(node) = find_mut(&mut nodes, id) {
        if node.kind == Kind::Folder && node.expanded != expanded {
            node.expanded = expanded;
            save(root, &nodes)?;
        }
    }
    Ok(())
}

/// Caminho absoluto de um item existente.
pub fn path_of(root: &Path, id: &str) -> Res<PathBuf> {
    let nodes = load(root)?;
    find(&nodes, id).ok_or("Item não encontrado.")?;
    Ok(abs_path(root, id))
}

fn clear_active(nodes: &mut [Node]) {
    for n in nodes {
        n.active = false;
        clear_active(&mut n.children);
    }
}

/// Marca o projeto aberto no canvas (`None` = nenhum). Só um por espaço.
pub fn set_active(root: &Path, id: Option<&str>) -> Res<()> {
    let mut nodes = load(root)?;
    if let Some(id) = id {
        match find(&nodes, id) {
            Some(n) if n.kind == Kind::Project => {}
            _ => return Err("Projeto não encontrado.".into()),
        }
    }
    clear_active(&mut nodes);
    if let Some(node) = id.and_then(|id| find_mut(&mut nodes, id)) {
        node.active = true;
    }
    save(root, &nodes)
}

/// Tamanho máximo dos cards salvos de um projeto (JSON).
const MAX_CANVAS_BYTES: usize = 512 * 1024;

/// Salva os cards do canvas de um projeto (lista JSON).
pub fn save_canvas(root: &Path, id: &str, canvas: serde_json::Value) -> Res<()> {
    if !canvas.is_array() {
        return Err("Formato de canvas inválido.".into());
    }
    let size = serde_json::to_string(&canvas).map(|s| s.len()).unwrap_or(usize::MAX);
    if size > MAX_CANVAS_BYTES {
        return Err("Canvas grande demais para salvar.".into());
    }
    let mut nodes = load(root)?;
    match find_mut(&mut nodes, id) {
        Some(node) if node.kind == Kind::Project => {
            if node.canvas.as_ref() == Some(&canvas) {
                return Ok(());
            }
            node.canvas = Some(canvas);
        }
        _ => return Err("Projeto não encontrado.".into()),
    }
    save(root, &nodes)
}

/// Salva a posição/zoom do canvas de um projeto.
pub fn save_view(root: &Path, id: &str, view: View) -> Res<()> {
    if !(view.x.is_finite() && view.y.is_finite() && view.zoom.is_finite() && view.zoom > 0.0) {
        return Err("Visualização inválida.".into());
    }
    let mut nodes = load(root)?;
    match find_mut(&mut nodes, id) {
        Some(node) if node.kind == Kind::Project => {
            if node.view.as_ref() == Some(&view) {
                return Ok(());
            }
            node.view = Some(view);
        }
        _ => return Err("Projeto não encontrado.".into()),
    }
    save(root, &nodes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Raiz temporária e isolada para cada teste.
    fn temp_root(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("logstudio-test-{tag}-{nanos}"))
    }

    #[test]
    fn create_rename_move_and_reconcile() {
        let root = temp_root("tree");

        // Criar pasta e projeto dentro dela
        let (_, folder) = create(&root, None, Kind::Folder).unwrap();
        assert_eq!(folder, "Nova pasta");
        let (_, project) = create(&root, Some(&folder), Kind::Project).unwrap();
        assert_eq!(project, "Nova pasta/Novo projeto");
        assert!(root.join("Nova pasta").join("Novo projeto").is_dir());

        // Nome único quando já existe
        let (_, folder2) = create(&root, None, Kind::Folder).unwrap();
        assert_eq!(folder2, "Nova pasta (2)");

        // Renomear pasta renomeia o diretório e atualiza os ids dos filhos
        let tree = rename(&root, "Nova pasta", "Clientes").unwrap();
        assert!(root.join("Clientes").join("Novo projeto").is_dir());
        assert_eq!(tree[0].children[0].id, "Clientes/Novo projeto");

        // Mover projeto para a raiz, antes da pasta
        let tree = move_node(&root, "Clientes/Novo projeto", Some("Clientes"), DropPos::Before).unwrap();
        assert_eq!(tree[0].id, "Novo projeto");
        assert!(root.join("Novo projeto").is_dir());
        assert!(!root.join("Clientes").join("Novo projeto").exists());

        // Mover para dentro de outra pasta
        let tree = move_node(&root, "Novo projeto", Some("Nova pasta (2)"), DropPos::Inside).unwrap();
        assert!(root.join("Nova pasta (2)").join("Novo projeto").is_dir());
        assert!(tree.iter().any(|n| n.id == "Nova pasta (2)" && n.children.len() == 1));

        // Pasta não entra nela mesma
        let (_, sub) = create(&root, Some("Clientes"), Kind::Folder).unwrap();
        assert!(move_node(&root, "Clientes", Some(&sub), DropPos::Inside).is_err());

        // Nomes inválidos e duplicados são recusados
        assert!(rename(&root, "Clientes", "a:b").is_err());
        assert!(rename(&root, "Clientes", "CON").is_err());
        assert!(rename(&root, "Clientes", "  ").is_err());
        assert!(rename(&root, "Clientes", "nova pasta (2)").is_err());

        // Diretório criado por fora aparece como projeto; ordem salva é mantida
        fs::create_dir(root.join("Externo")).unwrap();
        let tree = load(&root).unwrap();
        let names: Vec<_> = tree.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, ["Clientes", "Nova pasta (2)", "Externo"]);
        assert_eq!(tree[2].kind, Kind::Project);

        // Diretório apagado por fora some da árvore
        fs::remove_dir_all(root.join("Externo")).unwrap();
        assert_eq!(load(&root).unwrap().len(), 2);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn active_project_and_view_follow_rename_and_move() {
        let root = temp_root("active");
        let (_, folder) = create(&root, None, Kind::Folder).unwrap();
        let (_, project) = create(&root, Some(&folder), Kind::Project).unwrap();

        set_active(&root, Some(&project)).unwrap();
        let view = View { x: 120.0, y: -40.0, zoom: 1.5, fullscreen: Some("janela-1".into()) };
        save_view(&root, &project, view.clone()).unwrap();
        assert!(set_active(&root, Some(&folder)).is_err()); // pasta não pode ser "aberta"

        // Renomear a pasta mantém o projeto aberto e a visualização
        let tree = rename(&root, &folder, "Clientes").unwrap();
        let p = &tree[0].children[0];
        assert_eq!(p.id, "Clientes/Novo projeto");
        assert!(p.active);
        assert_eq!(p.view.as_ref(), Some(&view));

        // Mover para a raiz também
        let tree = move_node(&root, "Clientes/Novo projeto", None, DropPos::After).unwrap();
        let p = tree.iter().find(|n| n.id == "Novo projeto").unwrap();
        assert!(p.active);
        assert_eq!(p.view.as_ref(), Some(&view));

        // Só um projeto aberto por vez
        let (_, other) = create(&root, None, Kind::Project).unwrap();
        set_active(&root, Some(&other)).unwrap();
        let tree = load(&root).unwrap();
        let active: Vec<_> = tree.iter().filter(|n| n.active).map(|n| n.id.as_str()).collect();
        assert_eq!(active, [other.as_str()]);

        fs::remove_dir_all(&root).ok();
    }
}
