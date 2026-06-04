use chrono::Utc;
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;
use walkdir::WalkDir;

type CommandResult<T> = Result<T, String>;

#[derive(Default)]
struct ImportCache {
    plans: HashMap<String, ImportPlan>,
}

struct AppState {
    db_path: PathBuf,
    snapshots_dir: PathBuf,
    cache: Mutex<ImportCache>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SourceScan {
    id: String,
    label: String,
    path: String,
    provider: String,
    sessions_count: usize,
    archived_sessions_count: usize,
    threads_count: usize,
    projects_count: usize,
    goals_count: usize,
    readable: bool,
    errors: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ImportPreview {
    plan_id: String,
    source_count: usize,
    new_count: usize,
    duplicate_count: usize,
    conflict_count: usize,
    failed_count: usize,
    events: Vec<ImportEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ImportEvent {
    phase: String,
    message: String,
    progress: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ImportRunSummary {
    run_id: String,
    snapshot_path: String,
    inserted_conversations: usize,
    skipped_duplicates: usize,
    failed_items: usize,
    events: Vec<ImportEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ImportRunRow {
    id: String,
    status: String,
    started_at: i64,
    finished_at: Option<i64>,
    snapshot_path: Option<String>,
    inserted_conversations: i64,
    skipped_duplicates: i64,
    failed_items: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SearchQuery {
    keyword: Option<String>,
    source_id: Option<String>,
    model_provider: Option<String>,
    cwd: Option<String>,
    archived: Option<bool>,
    limit: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SearchResult {
    id: String,
    title: String,
    cwd: Option<String>,
    model_provider: Option<String>,
    archived: bool,
    updated_at: Option<i64>,
    snippet: String,
    source_count: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ConversationDetail {
    conversation: StoredConversation,
    messages: Vec<StoredMessage>,
    sources: Vec<ConversationSource>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StoredConversation {
    id: String,
    key: String,
    provider_id: Option<String>,
    provider: String,
    provider_name: Option<String>,
    title: String,
    cwd: Option<String>,
    model_provider: Option<String>,
    created_at: Option<i64>,
    updated_at: Option<i64>,
    archived: bool,
    tokens_used: i64,
    import_run_id: Option<String>,
    codex_imported: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ProviderRow {
    id: String,
    provider: String,
    name: String,
    created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ProviderOperationRow {
    id: String,
    kind: String,
    summary: String,
    snapshot_path: String,
    created_at: i64,
    metadata: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ProviderOperationSummary {
    operation: ProviderOperationRow,
    providers: Vec<ProviderRow>,
    conversations: Vec<StoredConversation>,
    operations: Vec<ProviderOperationRow>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct ProviderOperationMetadata {
    codex_writeback: Option<CodexWritebackMetadata>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CodexWritebackMetadata {
    codex_root: String,
    state_snapshot_path: String,
    written_files: Vec<String>,
    inserted_thread_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ProviderWorkspaceSummary {
    providers: Vec<ProviderRow>,
    conversations: Vec<StoredConversation>,
    operations: Vec<ProviderOperationRow>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct StoredMessage {
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    timestamp: Option<i64>,
    event_type: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ConversationSource {
    source_id: String,
    file_path: String,
    content_hash: String,
}

#[derive(Clone, Debug)]
struct ImportPlan {
    parsed: Vec<ParsedConversation>,
    duplicate_count: usize,
    conflict_count: usize,
    failed_count: usize,
}

#[derive(Clone, Debug)]
struct ParsedConversation {
    conversation: StoredConversation,
    messages: Vec<StoredMessage>,
    source: ConversationSource,
    errors: Vec<String>,
}

#[tauri::command]
fn scan_sources(paths: Vec<String>) -> CommandResult<Vec<SourceScan>> {
    let source_paths = if paths.is_empty() { default_codex_paths() } else { paths };
    Ok(source_paths.iter().map(|path| scan_source(Path::new(path))).collect())
}

#[tauri::command]
fn preview_import(state: State<AppState>, source_ids: Vec<String>) -> CommandResult<ImportPreview> {
    ensure_database(&state.db_path)?;
    let source_paths = if source_ids.is_empty() { default_codex_paths() } else { source_ids };
    let existing_keys = existing_conversation_keys(&state.db_path)?;
    let parsed = parse_sources(&source_paths);
    let mut seen_new = HashSet::new();
    let mut new_count = 0;
    let mut duplicate_count = 0;
    let mut conflict_count = 0;
    let mut failed_count = 0;

    for item in &parsed {
        if !item.errors.is_empty() {
            failed_count += 1;
        } else if existing_keys.contains(&item.conversation.key) {
            duplicate_count += 1;
        } else if !seen_new.insert(item.conversation.key.clone()) {
            conflict_count += 1;
        } else {
            new_count += 1;
        }
    }

    let plan_id = Uuid::new_v4().to_string();
    let events = vec![
        event("scan", "扫描源目录", 20),
        event("parse", "解析 JSONL / SQLite", 45),
        event("dedupe", "计算去重指纹", 70),
    ];

    let plan = ImportPlan {
        parsed,
        duplicate_count,
        conflict_count,
        failed_count,
    };
    state.cache.lock().map_err(|err| err.to_string())?.plans.insert(plan_id.clone(), plan);

    Ok(ImportPreview {
        plan_id,
        source_count: source_paths.len(),
        new_count,
        duplicate_count,
        conflict_count,
        failed_count,
        events,
    })
}

#[tauri::command]
fn run_import(app: AppHandle, state: State<AppState>, plan_id: String) -> CommandResult<ImportRunSummary> {
    ensure_database(&state.db_path)?;
    fs::create_dir_all(&state.snapshots_dir).map_err(|err| err.to_string())?;
    let plan = state
        .cache
        .lock()
        .map_err(|err| err.to_string())?
        .plans
        .remove(&plan_id)
        .ok_or_else(|| "Import plan not found; run preview_import first".to_string())?;

    let run_id = Uuid::new_v4().to_string();
    let snapshot_path = state.snapshots_dir.join(format!("{run_id}.sqlite"));
    copy_if_exists(&state.db_path, &snapshot_path)?;

    let mut events = vec![event("snapshot", "创建导入前快照", 80)];
    app.emit("import-progress", events.last().unwrap()).map_err(|err| err.to_string())?;

    let mut conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let started_at = Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO import_runs (id, status, started_at, snapshot_path, inserted_conversations, skipped_duplicates, failed_items)
         VALUES (?1, 'running', ?2, ?3, 0, ?4, ?5)",
        params![run_id, started_at, snapshot_path.to_string_lossy(), plan.duplicate_count as i64, plan.failed_count as i64],
    )
    .map_err(|err| err.to_string())?;

    let tx = conn.transaction().map_err(|err| err.to_string())?;
    let mut inserted = 0;
    for item in plan.parsed.iter().filter(|item| item.errors.is_empty()) {
        let changed = insert_conversation(&tx, &run_id, item)?;
        if changed {
            inserted += 1;
        }
    }
    tx.commit().map_err(|err| err.to_string())?;

    let finished_at = Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE import_runs SET status = 'completed', finished_at = ?2, inserted_conversations = ?3 WHERE id = ?1",
        params![run_id, finished_at, inserted as i64],
    )
    .map_err(|err| err.to_string())?;

    events.push(event("write", "写入合并库", 95));
    app.emit("import-progress", events.last().unwrap()).map_err(|err| err.to_string())?;
    events.push(event("done", "导入完成", 100));
    app.emit("import-progress", events.last().unwrap()).map_err(|err| err.to_string())?;

    Ok(ImportRunSummary {
        run_id,
        snapshot_path: snapshot_path.to_string_lossy().to_string(),
        inserted_conversations: inserted,
        skipped_duplicates: plan.duplicate_count + plan.conflict_count,
        failed_items: plan.failed_count,
        events,
    })
}

#[tauri::command]
fn list_import_runs(state: State<AppState>) -> CommandResult<Vec<ImportRunRow>> {
    ensure_database(&state.db_path)?;
    let conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, status, started_at, finished_at, snapshot_path, inserted_conversations, skipped_duplicates, failed_items
             FROM import_runs ORDER BY started_at DESC",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ImportRunRow {
                id: row.get(0)?,
                status: row.get(1)?,
                started_at: row.get(2)?,
                finished_at: row.get(3)?,
                snapshot_path: row.get(4)?,
                inserted_conversations: row.get(5)?,
                skipped_duplicates: row.get(6)?,
                failed_items: row.get(7)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

#[tauri::command]
fn rollback_import(state: State<AppState>, run_id: String) -> CommandResult<ImportRunSummary> {
    ensure_database(&state.db_path)?;
    let snapshot_path = snapshot_for_run(&state.db_path, &run_id)?;
    fs::copy(&snapshot_path, &state.db_path).map_err(|err| err.to_string())?;
    Ok(ImportRunSummary {
        run_id,
        snapshot_path,
        inserted_conversations: 0,
        skipped_duplicates: 0,
        failed_items: 0,
        events: vec![event("rollback", "恢复到导入前快照", 100)],
    })
}

#[tauri::command]
fn search_conversations(state: State<AppState>, query: SearchQuery) -> CommandResult<Vec<SearchResult>> {
    ensure_database(&state.db_path)?;
    let conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let keyword = query.keyword.unwrap_or_default().to_lowercase();
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.title, c.cwd, c.model_provider, c.archived, c.updated_at,
                    COALESCE((SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND lower(m.content) LIKE ?1 LIMIT 1), ''),
                    (SELECT COUNT(*) FROM conversation_sources cs WHERE cs.conversation_id = c.id)
             FROM conversations c
             WHERE (?2 = '' OR lower(c.title || ' ' || COALESCE(c.cwd, '') || ' ' || COALESCE(c.model_provider, '')) LIKE ?1
                    OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND lower(m.content) LIKE ?1))
               AND (?3 = '' OR c.model_provider = ?3)
               AND (?4 = '' OR c.cwd = ?4)
               AND (?5 IS NULL OR c.archived = ?5)
             ORDER BY COALESCE(c.updated_at, c.created_at, 0) DESC
             LIMIT ?6",
        )
        .map_err(|err| err.to_string())?;
    let pattern = format!("%{}%", keyword);
    let archived = query.archived.map(|value| if value { 1 } else { 0 });
    let limit = query.limit.unwrap_or(100).min(500) as i64;
    let rows = stmt
        .query_map(
            params![
                pattern,
                keyword,
                query.model_provider.unwrap_or_default(),
                query.cwd.unwrap_or_default(),
                archived,
                limit
            ],
            |row| {
                Ok(SearchResult {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    cwd: row.get(2)?,
                    model_provider: row.get(3)?,
                    archived: row.get::<_, i64>(4)? == 1,
                    updated_at: row.get(5)?,
                    snippet: row.get(6)?,
                    source_count: row.get(7)?,
                })
            },
        )
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

#[tauri::command]
fn get_conversation(state: State<AppState>, id: String) -> CommandResult<ConversationDetail> {
    ensure_database(&state.db_path)?;
    let conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let conversation = conn
        .query_row(
            "SELECT id, key, provider_id, provider, provider_name, title, cwd, model_provider, created_at, updated_at, archived, tokens_used, import_run_id, codex_imported
             FROM conversations WHERE id = ?1",
            params![id],
            |row| {
                Ok(StoredConversation {
                    id: row.get(0)?,
                    key: row.get(1)?,
                    provider_id: row.get(2)?,
                    provider: row.get(3)?,
                    provider_name: row.get(4)?,
                    title: row.get(5)?,
                    cwd: row.get(6)?,
                    model_provider: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    archived: row.get::<_, i64>(10)? == 1,
                    tokens_used: row.get(11)?,
                    import_run_id: row.get(12)?,
                    codex_imported: row.get::<_, i64>(13)? == 1,
                })
            },
        )
        .map_err(|err| err.to_string())?;
    Ok(ConversationDetail {
        messages: load_messages(&conn, &conversation.id)?,
        sources: load_conversation_sources(&conn, &conversation.id)?,
        conversation,
    })
}

#[tauri::command]
fn list_provider_workspace(state: State<AppState>) -> CommandResult<ProviderWorkspaceSummary> {
    ensure_database(&state.db_path)?;
    let conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    Ok(ProviderWorkspaceSummary {
        providers: list_providers_from_conn(&conn)?,
        conversations: list_conversations_from_conn(&conn)?,
        operations: list_provider_operations_from_conn(&conn)?,
    })
}

#[tauri::command]
fn create_provider(state: State<AppState>, provider: String, name: String) -> CommandResult<ProviderOperationSummary> {
    ensure_database(&state.db_path)?;
    ensure_codex_provider(&provider)?;
    let operation = snapshot_provider_operation(&state, "create-provider", format!("Create provider {name}"))?;
    let conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let provider_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO providers (id, provider, name, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![provider_id, provider, name, Utc::now().timestamp_millis()],
    )
    .map_err(|err| err.to_string())?;
    Ok(ProviderOperationSummary {
        operation,
        providers: list_providers_from_conn(&conn)?,
        conversations: list_conversations_from_conn(&conn)?,
        operations: list_provider_operations_from_conn(&conn)?,
    })
}

#[tauri::command]
fn rename_provider(
    state: State<AppState>,
    provider_id: String,
    provider: Option<String>,
    name: Option<String>,
) -> CommandResult<ProviderOperationSummary> {
    ensure_database(&state.db_path)?;
    if let Some(provider) = provider.as_deref() {
        ensure_codex_provider(provider)?;
    }
    let operation = snapshot_provider_operation(&state, "rename-provider", format!("Rename provider {provider_id}"))?;
    let conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let current = load_provider(&conn, &provider_id)?;
    let next_provider = provider.unwrap_or(current.provider);
    let next_name = name.unwrap_or(current.name);
    conn.execute(
        "UPDATE providers SET provider = ?2, name = ?3 WHERE id = ?1",
        params![provider_id, next_provider, next_name],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE conversations SET provider = ?2, provider_name = ?3 WHERE provider_id = ?1",
        params![provider_id, next_provider, next_name],
    )
    .map_err(|err| err.to_string())?;
    Ok(ProviderOperationSummary {
        operation,
        providers: list_providers_from_conn(&conn)?,
        conversations: list_conversations_from_conn(&conn)?,
        operations: list_provider_operations_from_conn(&conn)?,
    })
}

#[tauri::command]
fn merge_providers(
    state: State<AppState>,
    target_provider_id: String,
    source_provider_ids: Vec<String>,
    writeback_to_codex: bool,
) -> CommandResult<ProviderOperationSummary> {
    ensure_database(&state.db_path)?;
    if source_provider_ids.is_empty() {
        return Err("At least one source provider is required".to_string());
    }
    let operation = snapshot_provider_operation(&state, "merge-providers", format!("Merge providers into {target_provider_id}"))?;
    let mut conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let target = load_provider(&conn, &target_provider_id)?;
    let mut writeback_conversation_ids = Vec::new();
    if writeback_to_codex && target.provider == "Codex" {
        for source_id in &source_provider_ids {
            if source_id == &target_provider_id {
                continue;
            }
            writeback_conversation_ids.extend(
                list_provider_conversations_from_conn(&conn, source_id)?
                    .into_iter()
                    .map(|conversation| conversation.id),
            );
        }
    }
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    for source_id in &source_provider_ids {
        if source_id == &target_provider_id {
            continue;
        }
        tx.execute(
            "UPDATE conversations
             SET provider_id = ?1, provider = ?2, provider_name = ?3, codex_imported = CASE WHEN ?4 = 1 AND ?2 = 'Codex' THEN 1 ELSE codex_imported END
             WHERE provider_id = ?5",
            params![
                &target_provider_id,
                &target.provider,
                &target.name,
                if writeback_to_codex { 1 } else { 0 },
                source_id
            ],
        )
        .map_err(|err| err.to_string())?;
        tx.execute("DELETE FROM providers WHERE id = ?1", params![source_id])
            .map_err(|err| err.to_string())?;
    }
    tx.commit().map_err(|err| err.to_string())?;
    let mut operation = operation;
    if writeback_to_codex && target.provider == "Codex" {
        let metadata = match write_conversation_ids_to_codex(&state, &operation.id, &writeback_conversation_ids) {
            Ok(metadata) => metadata,
            Err(err) => {
                let _ = fs::copy(&operation.snapshot_path, &state.db_path);
                return Err(err);
            }
        };
        if let Err(err) = persist_provider_operation_metadata(&state.db_path, &operation.id, &metadata) {
            let metadata_json = serde_json::to_string(&metadata).map_err(|err| err.to_string())?;
            let _ = rollback_codex_writeback(Some(&metadata_json));
            let _ = fs::copy(&operation.snapshot_path, &state.db_path);
            return Err(err);
        }
        operation.metadata = Some(serde_json::to_string(&metadata).map_err(|err| err.to_string())?);
    }
    Ok(ProviderOperationSummary {
        operation,
        providers: list_providers_from_conn(&conn)?,
        conversations: list_conversations_from_conn(&conn)?,
        operations: list_provider_operations_from_conn(&conn)?,
    })
}

#[tauri::command]
fn writeback_to_codex(state: State<AppState>, provider_id: String) -> CommandResult<ProviderOperationSummary> {
    ensure_database(&state.db_path)?;
    let mut operation = snapshot_provider_operation(&state, "writeback-to-codex", format!("Write provider {provider_id} to Codex"))?;
    let mut conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let metadata = match write_provider_conversations_to_codex(&state, &operation.id, &provider_id) {
        Ok(metadata) => metadata,
        Err(err) => {
            let _ = fs::copy(&operation.snapshot_path, &state.db_path);
            return Err(err);
        }
    };
    let provider_row = load_provider(&conn, &provider_id)?;
    let metadata_json = serde_json::to_string(&metadata).map_err(|err| err.to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    let db_result = (|| -> CommandResult<()> {
        tx.execute(
            "UPDATE providers SET provider = 'Codex' WHERE id = ?1",
            params![provider_id],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "UPDATE conversations SET provider = 'Codex', provider_name = ?2, codex_imported = 1 WHERE provider_id = ?1",
            params![provider_id, provider_row.name],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "UPDATE provider_operations SET metadata = ?2 WHERE id = ?1",
            params![operation.id, metadata_json],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    })();
    match db_result {
        Ok(()) => tx.commit().map_err(|err| err.to_string())?,
        Err(err) => {
            let _ = tx.rollback();
            let _ = rollback_codex_writeback(Some(&metadata_json));
            let _ = fs::copy(&operation.snapshot_path, &state.db_path);
            return Err(err);
        }
    }
    operation.metadata = Some(metadata_json);
    Ok(ProviderOperationSummary {
        operation,
        providers: list_providers_from_conn(&conn)?,
        conversations: list_conversations_from_conn(&conn)?,
        operations: list_provider_operations_from_conn(&conn)?,
    })
}

#[tauri::command]
fn rollback_provider_operation(state: State<AppState>, operation_id: String) -> CommandResult<ProviderOperationSummary> {
    ensure_database(&state.db_path)?;
    let conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let operation = conn
        .query_row(
            "SELECT id, kind, summary, snapshot_path, created_at, metadata FROM provider_operations WHERE id = ?1",
            params![operation_id],
            provider_operation_from_row,
        )
        .map_err(|err| err.to_string())?;
    drop(conn);
    rollback_codex_writeback(operation.metadata.as_deref())?;
    fs::copy(&operation.snapshot_path, &state.db_path).map_err(|err| err.to_string())?;
    let conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    Ok(ProviderOperationSummary {
        operation,
        providers: list_providers_from_conn(&conn)?,
        conversations: list_conversations_from_conn(&conn)?,
        operations: list_provider_operations_from_conn(&conn)?,
    })
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_dir)?;
            let db_path = app_dir.join("codex-history-merger.sqlite");
            let snapshots_dir = app_dir.join("snapshots");
            fs::create_dir_all(&snapshots_dir)?;
            ensure_database(&db_path).map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
            app.manage(AppState {
                db_path,
                snapshots_dir,
                cache: Mutex::new(ImportCache::default()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_sources,
            preview_import,
            run_import,
            list_import_runs,
            rollback_import,
            search_conversations,
            get_conversation,
            list_provider_workspace,
            create_provider,
            rename_provider,
            merge_providers,
            writeback_to_codex,
            rollback_provider_operation
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex History Merger");
}

fn ensure_database(path: &Path) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let conn = Connection::open(path).map_err(|err| err.to_string())?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          provider TEXT NOT NULL,
          scanned_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS providers (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL UNIQUE,
          provider_id TEXT,
          provider TEXT NOT NULL,
          provider_name TEXT,
          title TEXT NOT NULL,
          cwd TEXT,
          model_provider TEXT,
          created_at INTEGER,
          updated_at INTEGER,
          archived INTEGER NOT NULL DEFAULT 0,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          import_run_id TEXT,
          codex_imported INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS conversation_sources (
          conversation_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          PRIMARY KEY (conversation_id, source_id, file_path)
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER,
          event_type TEXT
        );
        CREATE TABLE IF NOT EXISTS import_runs (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          snapshot_path TEXT,
          inserted_conversations INTEGER NOT NULL DEFAULT 0,
          skipped_duplicates INTEGER NOT NULL DEFAULT 0,
          failed_items INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS import_events (
          id TEXT PRIMARY KEY,
          import_run_id TEXT NOT NULL,
          phase TEXT NOT NULL,
          message TEXT NOT NULL,
          progress INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS provider_operations (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          summary TEXT NOT NULL,
          snapshot_path TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_cwd ON conversations(cwd);
        CREATE INDEX IF NOT EXISTS idx_conversations_model_provider ON conversations(model_provider);
        CREATE INDEX IF NOT EXISTS idx_conversations_provider_id ON conversations(provider_id);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);
        ",
    )
    .map_err(|err| err.to_string())?;
    ensure_column(&conn, "conversations", "provider_id", "TEXT")?;
    ensure_column(&conn, "conversations", "provider_name", "TEXT")?;
    ensure_column(&conn, "conversations", "codex_imported", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&conn, "provider_operations", "metadata", "TEXT")?;
    Ok(())
}

fn scan_source(path: &Path) -> SourceScan {
    let mut errors = Vec::new();
    let readable = path.is_dir();
    if !readable {
        errors.push("目录不存在或不可读".to_string());
    }
    let sessions_count = count_jsonl_files(&path.join("sessions"), true);
    let archived_sessions_count = count_jsonl_files(&path.join("archived_sessions"), false);
    let (threads_count, projects_count) = read_thread_stats(&path.join("state_5.sqlite")).unwrap_or_else(|err| {
        errors.push(err);
        (0, 0)
    });
    let goals_count = read_goal_count(&path.join("goals_1.sqlite")).unwrap_or_else(|err| {
        if path.join("goals_1.sqlite").exists() {
            errors.push(err);
        }
        0
    });
    SourceScan {
        id: source_id(path),
        label: path.file_name().and_then(|name| name.to_str()).unwrap_or(".codex").to_string(),
        path: path.to_string_lossy().to_string(),
        provider: "Codex".to_string(),
        sessions_count,
        archived_sessions_count,
        threads_count,
        projects_count,
        goals_count,
        readable,
        errors,
    }
}

fn parse_sources(source_paths: &[String]) -> Vec<ParsedConversation> {
    source_paths
        .iter()
        .flat_map(|source| parse_source(Path::new(source)))
        .collect()
}

fn parse_source(source: &Path) -> Vec<ParsedConversation> {
    let source_id = source_id(source);
    let thread_meta = read_thread_meta(&source.join("state_5.sqlite")).unwrap_or_default();
    let mut files = Vec::new();
    files.extend(jsonl_files(&source.join("sessions"), true, false));
    files.extend(jsonl_files(&source.join("archived_sessions"), false, true));
    files
        .iter()
        .map(|(path, archived)| parse_jsonl_file(&source_id, path, *archived, &thread_meta))
        .collect()
}

fn parse_jsonl_file(
    source_id: &str,
    file_path: &Path,
    archived: bool,
    thread_meta: &HashMap<String, StoredConversation>,
) -> ParsedConversation {
    let content = fs::read_to_string(file_path).unwrap_or_default();
    let content_hash = hash_text(&content);
    let rollout_id = file_path.file_stem().and_then(|stem| stem.to_str()).unwrap_or(&content_hash).to_string();
    let meta = thread_meta.get(&rollout_id);
    let key = meta
        .map(|item| format!("thread:{}", item.id))
        .unwrap_or_else(|| format!("rollout:{rollout_id}"));
    let mut messages = Vec::new();
    let mut errors = Vec::new();
    for (index, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            errors.push(format!("Invalid JSON line {}", index + 1));
            continue;
        };
        let text = extract_payload_text(event.get("payload"));
        if text.is_empty() {
            continue;
        }
        let event_type = event.get("type").and_then(Value::as_str).map(ToString::to_string);
        messages.push(StoredMessage {
            id: format!("{rollout_id}-{}", index + 1),
            conversation_id: rollout_id.clone(),
            role: infer_role(event_type.as_deref()),
            content: text,
            timestamp: event.get("timestamp").and_then(Value::as_str).and_then(parse_timestamp),
            event_type,
        });
    }
    let title = meta
        .map(|item| item.title.clone())
        .or_else(|| messages.iter().find(|item| item.role == "user").map(|item| item.content.clone()))
        .unwrap_or_else(|| rollout_id.clone());
    ParsedConversation {
        conversation: StoredConversation {
            id: meta.map(|item| item.id.clone()).unwrap_or(rollout_id.clone()),
            key,
            provider: "Codex".to_string(),
            provider_id: Some(source_id.to_string()),
            provider_name: Some("Codex".to_string()),
            title,
            cwd: meta.and_then(|item| item.cwd.clone()),
            model_provider: meta.and_then(|item| item.model_provider.clone()),
            created_at: meta.and_then(|item| item.created_at),
            updated_at: meta.and_then(|item| item.updated_at),
            archived: meta.map(|item| item.archived).unwrap_or(archived),
            tokens_used: meta.map(|item| item.tokens_used).unwrap_or(0),
            import_run_id: None,
            codex_imported: false,
        },
        messages,
        source: ConversationSource {
            source_id: source_id.to_string(),
            file_path: file_path.to_string_lossy().to_string(),
            content_hash,
        },
        errors,
    }
}

fn insert_conversation(conn: &Connection, run_id: &str, item: &ParsedConversation) -> CommandResult<bool> {
    let provider_id = item.conversation.provider_id.clone().unwrap_or_else(|| item.source.source_id.clone());
    conn.execute(
        "INSERT OR IGNORE INTO providers (id, provider, name, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![
            provider_id,
            item.conversation.provider,
            item.conversation.provider_name.clone().unwrap_or_else(|| item.conversation.provider.clone()),
            Utc::now().timestamp_millis()
        ],
    )
    .map_err(|err| err.to_string())?;
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO conversations
             (id, key, provider_id, provider, provider_name, title, cwd, model_provider, created_at, updated_at, archived, tokens_used, import_run_id, codex_imported)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                item.conversation.id,
                item.conversation.key,
                item.conversation.provider_id,
                item.conversation.provider,
                item.conversation.provider_name,
                item.conversation.title,
                item.conversation.cwd,
                item.conversation.model_provider,
                item.conversation.created_at,
                item.conversation.updated_at,
                if item.conversation.archived { 1 } else { 0 },
                item.conversation.tokens_used,
                run_id,
                if item.conversation.codex_imported { 1 } else { 0 }
            ],
        )
        .map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO conversation_sources (conversation_id, source_id, file_path, content_hash) VALUES (?1, ?2, ?3, ?4)",
        params![item.conversation.id, item.source.source_id, item.source.file_path, item.source.content_hash],
    )
    .map_err(|err| err.to_string())?;
    for message in &item.messages {
        conn.execute(
            "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, timestamp, event_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![message.id, item.conversation.id, message.role, message.content, message.timestamp, message.event_type],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(changed > 0)
}

fn existing_conversation_keys(db_path: &Path) -> CommandResult<HashSet<String>> {
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    let mut stmt = conn.prepare("SELECT key FROM conversations").map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<HashSet<_>, _>>().map_err(|err| err.to_string())
}

fn ensure_codex_provider(provider: &str) -> CommandResult<()> {
    if provider == "Codex" {
        Ok(())
    } else {
        Err("v1 only supports Codex-format history sources".to_string())
    }
}

fn write_provider_conversations_to_codex(
    state: &AppState,
    operation_id: &str,
    provider_id: &str,
) -> CommandResult<ProviderOperationMetadata> {
    let app_conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let conversation_ids = list_provider_conversations_from_conn(&app_conn, provider_id)?
        .into_iter()
        .map(|conversation| conversation.id)
        .collect::<Vec<_>>();
    write_conversation_ids_to_codex(state, operation_id, &conversation_ids)
}

fn write_conversation_ids_to_codex(
    state: &AppState,
    operation_id: &str,
    conversation_ids: &[String],
) -> CommandResult<ProviderOperationMetadata> {
    let codex_root = dirs::home_dir()
        .map(|home| home.join(".codex"))
        .ok_or_else(|| "Cannot locate home directory for Codex writeback".to_string())?;
    let sessions_dir = codex_root
        .join("sessions")
        .join("imported_by_history_merger")
        .join(operation_id);
    let state_path = codex_root.join("state_5.sqlite");
    let state_snapshot_path = state.snapshots_dir.join(format!("codex-state-{operation_id}.sqlite"));
    if !state_path.exists() {
        return Err(format!("Codex state database does not exist: {}", state_path.to_string_lossy()));
    }

    fs::create_dir_all(&sessions_dir).map_err(|err| err.to_string())?;
    copy_if_exists(&state_path, &state_snapshot_path)?;

    let app_conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    let conversations = list_conversations_by_ids_from_conn(&app_conn, conversation_ids)?;
    if conversations.is_empty() {
        return Err("No conversations to write back to Codex".to_string());
    }

    let result = (|| -> CommandResult<CodexWritebackMetadata> {
        let codex_conn = Connection::open(&state_path).map_err(|err| err.to_string())?;
        let mut written_files = Vec::new();
        let mut inserted_thread_ids = Vec::new();
        for conversation in conversations {
            let messages = load_messages(&app_conn, &conversation.id)?;
            let codex_thread_id = format!("history-merger-{}", conversation.id);
            let rollout_path = sessions_dir.join(format!("{}.jsonl", safe_file_stem(&codex_thread_id)));
            write_codex_jsonl(&rollout_path, &codex_thread_id, &conversation, &messages)?;
            upsert_codex_thread(&codex_conn, &codex_thread_id, &conversation, &rollout_path)?;
            written_files.push(rollout_path.to_string_lossy().to_string());
            inserted_thread_ids.push(codex_thread_id);
        }
        Ok(CodexWritebackMetadata {
            codex_root: codex_root.to_string_lossy().to_string(),
            state_snapshot_path: state_snapshot_path.to_string_lossy().to_string(),
            written_files,
            inserted_thread_ids,
        })
    })();

    match result {
        Ok(codex_writeback) => Ok(ProviderOperationMetadata {
            codex_writeback: Some(codex_writeback),
        }),
        Err(err) => {
            let _ = fs::copy(&state_snapshot_path, &state_path);
            let _ = fs::remove_dir_all(&sessions_dir);
            Err(err)
        }
    }
}

fn persist_provider_operation_metadata(
    db_path: &Path,
    operation_id: &str,
    metadata: &ProviderOperationMetadata,
) -> CommandResult<()> {
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    let metadata_json = serde_json::to_string(metadata).map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE provider_operations SET metadata = ?2 WHERE id = ?1",
        params![operation_id, metadata_json],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn rollback_codex_writeback(metadata_json: Option<&str>) -> CommandResult<()> {
    let Some(metadata_json) = metadata_json else {
        return Ok(());
    };
    let metadata: ProviderOperationMetadata = serde_json::from_str(metadata_json).map_err(|err| err.to_string())?;
    let Some(codex) = metadata.codex_writeback else {
        return Ok(());
    };
    let codex_root = PathBuf::from(&codex.codex_root);
    let state_path = codex_root.join("state_5.sqlite");
    fs::copy(&codex.state_snapshot_path, state_path).map_err(|err| err.to_string())?;
    for file_path in codex.written_files {
        let path = PathBuf::from(file_path);
        if path.exists() {
            fs::remove_file(path).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn snapshot_provider_operation(state: &AppState, kind: &str, summary: String) -> CommandResult<ProviderOperationRow> {
    fs::create_dir_all(&state.snapshots_dir).map_err(|err| err.to_string())?;
    let id = Uuid::new_v4().to_string();
    let snapshot_path = state.snapshots_dir.join(format!("provider-{id}.sqlite"));
    copy_if_exists(&state.db_path, &snapshot_path)?;
    let operation = ProviderOperationRow {
        id,
        kind: kind.to_string(),
        summary,
        snapshot_path: snapshot_path.to_string_lossy().to_string(),
        created_at: Utc::now().timestamp_millis(),
        metadata: None,
    };
    let conn = Connection::open(&state.db_path).map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT INTO provider_operations (id, kind, summary, snapshot_path, created_at, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![operation.id, operation.kind, operation.summary, operation.snapshot_path, operation.created_at, operation.metadata],
    )
    .map_err(|err| err.to_string())?;
    Ok(operation)
}

fn load_provider(conn: &Connection, provider_id: &str) -> CommandResult<ProviderRow> {
    conn.query_row(
        "SELECT id, provider, name, created_at FROM providers WHERE id = ?1",
        params![provider_id],
        provider_from_row,
    )
    .map_err(|err| err.to_string())
}

fn list_providers_from_conn(conn: &Connection) -> CommandResult<Vec<ProviderRow>> {
    let mut stmt = conn
        .prepare("SELECT id, provider, name, created_at FROM providers ORDER BY created_at, name")
        .map_err(|err| err.to_string())?;
    let rows = stmt.query_map([], provider_from_row).map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn list_provider_operations_from_conn(conn: &Connection) -> CommandResult<Vec<ProviderOperationRow>> {
    let mut stmt = conn
        .prepare("SELECT id, kind, summary, snapshot_path, created_at, metadata FROM provider_operations ORDER BY created_at DESC")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], provider_operation_from_row)
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn list_conversations_from_conn(conn: &Connection) -> CommandResult<Vec<StoredConversation>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, key, provider_id, provider, provider_name, title, cwd, model_provider, created_at, updated_at, archived, tokens_used, import_run_id, codex_imported
             FROM conversations ORDER BY COALESCE(updated_at, created_at, 0) DESC, title",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(StoredConversation {
                id: row.get(0)?,
                key: row.get(1)?,
                provider_id: row.get(2)?,
                provider: row.get(3)?,
                provider_name: row.get(4)?,
                title: row.get(5)?,
                cwd: row.get(6)?,
                model_provider: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                archived: row.get::<_, i64>(10)? == 1,
                tokens_used: row.get(11)?,
                import_run_id: row.get(12)?,
                codex_imported: row.get::<_, i64>(13)? == 1,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn list_provider_conversations_from_conn(conn: &Connection, provider_id: &str) -> CommandResult<Vec<StoredConversation>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, key, provider_id, provider, provider_name, title, cwd, model_provider, created_at, updated_at, archived, tokens_used, import_run_id, codex_imported
             FROM conversations WHERE provider_id = ?1 ORDER BY COALESCE(updated_at, created_at, 0) DESC, title",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![provider_id], |row| {
            Ok(StoredConversation {
                id: row.get(0)?,
                key: row.get(1)?,
                provider_id: row.get(2)?,
                provider: row.get(3)?,
                provider_name: row.get(4)?,
                title: row.get(5)?,
                cwd: row.get(6)?,
                model_provider: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                archived: row.get::<_, i64>(10)? == 1,
                tokens_used: row.get(11)?,
                import_run_id: row.get(12)?,
                codex_imported: row.get::<_, i64>(13)? == 1,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn list_conversations_by_ids_from_conn(conn: &Connection, conversation_ids: &[String]) -> CommandResult<Vec<StoredConversation>> {
    let mut conversations = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, key, provider_id, provider, provider_name, title, cwd, model_provider, created_at, updated_at, archived, tokens_used, import_run_id, codex_imported
             FROM conversations WHERE id = ?1",
        )
        .map_err(|err| err.to_string())?;
    for conversation_id in conversation_ids {
        let conversation = stmt
            .query_row(params![conversation_id], |row| {
                Ok(StoredConversation {
                    id: row.get(0)?,
                    key: row.get(1)?,
                    provider_id: row.get(2)?,
                    provider: row.get(3)?,
                    provider_name: row.get(4)?,
                    title: row.get(5)?,
                    cwd: row.get(6)?,
                    model_provider: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    archived: row.get::<_, i64>(10)? == 1,
                    tokens_used: row.get(11)?,
                    import_run_id: row.get(12)?,
                    codex_imported: row.get::<_, i64>(13)? == 1,
                })
            })
            .map_err(|err| err.to_string())?;
        conversations.push(conversation);
    }
    Ok(conversations)
}

fn write_codex_jsonl(
    path: &Path,
    codex_thread_id: &str,
    conversation: &StoredConversation,
    messages: &[StoredMessage],
) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let mut file = File::create(path).map_err(|err| err.to_string())?;
    for message in messages {
        let payload = json!({
            "role": message.role,
            "content": message.content,
        });
        let event = json!({
            "timestamp": message.timestamp.unwrap_or_else(|| conversation.updated_at.or(conversation.created_at).unwrap_or_else(|| Utc::now().timestamp_millis())),
            "type": format!("history_merger_{}", message.role),
            "payload": payload,
            "history_merger": {
                "thread_id": codex_thread_id,
                "source_conversation_id": conversation.id,
            },
        });
        writeln!(file, "{event}").map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn upsert_codex_thread(
    conn: &Connection,
    codex_thread_id: &str,
    conversation: &StoredConversation,
    rollout_path: &Path,
) -> CommandResult<()> {
    let now_ms = Utc::now().timestamp_millis();
    let created_at_ms = conversation.created_at.unwrap_or(now_ms);
    let updated_at_ms = conversation.updated_at.unwrap_or(created_at_ms);
    conn.execute(
        "INSERT OR REPLACE INTO threads (
            id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy,
            approval_mode, tokens_used, has_user_event, archived, archived_at, cli_version, first_user_message,
            memory_mode, created_at_ms, updated_at_ms, thread_source, preview
         ) VALUES (
            ?1, ?2, ?3, ?4, 'history-merger', ?5, ?6, ?7, 'unknown',
            'unknown', ?8, 1, ?9, NULL, 'history-merger', '',
            'enabled', ?10, ?11, 'history-merger', ?12
         )",
        params![
            codex_thread_id,
            rollout_path.to_string_lossy(),
            created_at_ms / 1000,
            updated_at_ms / 1000,
            conversation.model_provider.clone().unwrap_or_else(|| "unknown".to_string()),
            conversation.cwd.clone().unwrap_or_default(),
            &conversation.title,
            conversation.tokens_used,
            if conversation.archived { 1 } else { 0 },
            created_at_ms,
            updated_at_ms,
            &conversation.title
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn provider_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProviderRow> {
    Ok(ProviderRow {
        id: row.get(0)?,
        provider: row.get(1)?,
        name: row.get(2)?,
        created_at: row.get(3)?,
    })
}

fn provider_operation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProviderOperationRow> {
    Ok(ProviderOperationRow {
        id: row.get(0)?,
        kind: row.get(1)?,
        summary: row.get(2)?,
        snapshot_path: row.get(3)?,
        created_at: row.get(4)?,
        metadata: row.get(5)?,
    })
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> CommandResult<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| err.to_string())?;
    let columns = rows.collect::<Result<HashSet<_>, _>>().map_err(|err| err.to_string())?;
    if !columns.contains(column) {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"), [])
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn read_thread_stats(path: &Path) -> Result<(usize, usize), String> {
    if !path.exists() {
        return Ok((0, 0));
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|err| err.to_string())?;
    let threads_count: i64 = conn.query_row("SELECT COUNT(*) FROM threads", [], |row| row.get(0)).map_err(|err| err.to_string())?;
    let projects_count: i64 = conn
        .query_row("SELECT COUNT(DISTINCT cwd) FROM threads WHERE cwd <> ''", [], |row| row.get(0))
        .map_err(|err| err.to_string())?;
    Ok((threads_count as usize, projects_count as usize))
}

fn read_goal_count(path: &Path) -> Result<usize, String> {
    if !path.exists() {
        return Ok(0);
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|err| err.to_string())?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM thread_goals", [], |row| row.get(0)).map_err(|err| err.to_string())?;
    Ok(count as usize)
}

fn read_thread_meta(path: &Path) -> Result<HashMap<String, StoredConversation>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|err| err.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, rollout_path, title, cwd, model_provider, created_at_ms, updated_at_ms, archived, tokens_used
             FROM threads",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let rollout_path: String = row.get(1)?;
            let rollout_id = Path::new(&rollout_path).file_stem().and_then(|stem| stem.to_str()).unwrap_or("").to_string();
            Ok((
                rollout_id,
                StoredConversation {
                    id: row.get(0)?,
                    key: String::new(),
                    provider_id: None,
                    provider: "Codex".to_string(),
                    provider_name: Some("Codex".to_string()),
                    title: row.get(2)?,
                    cwd: row.get(3)?,
                    model_provider: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    archived: row.get::<_, i64>(7)? == 1,
                    tokens_used: row.get(8)?,
                    import_run_id: None,
                    codex_imported: false,
                },
            ))
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<HashMap<_, _>, _>>().map_err(|err| err.to_string())
}

fn load_messages(conn: &Connection, conversation_id: &str) -> CommandResult<Vec<StoredMessage>> {
    let mut stmt = conn
        .prepare("SELECT id, conversation_id, role, content, timestamp, event_type FROM messages WHERE conversation_id = ?1 ORDER BY timestamp, id")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
                event_type: row.get(5)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn load_conversation_sources(conn: &Connection, conversation_id: &str) -> CommandResult<Vec<ConversationSource>> {
    let mut stmt = conn
        .prepare("SELECT source_id, file_path, content_hash FROM conversation_sources WHERE conversation_id = ?1")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(ConversationSource {
                source_id: row.get(0)?,
                file_path: row.get(1)?,
                content_hash: row.get(2)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn snapshot_for_run(db_path: &Path, run_id: &str) -> CommandResult<String> {
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    conn.query_row("SELECT snapshot_path FROM import_runs WHERE id = ?1", params![run_id], |row| row.get(0))
        .map_err(|err| err.to_string())
}

fn count_jsonl_files(path: &Path, recursive: bool) -> usize {
    jsonl_files(path, recursive, false).len()
}

fn jsonl_files(path: &Path, recursive: bool, archived: bool) -> Vec<(PathBuf, bool)> {
    if !path.exists() {
        return Vec::new();
    }
    if recursive {
        WalkDir::new(path)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file() && has_jsonl_extension(entry.path()))
            .map(|entry| (entry.into_path(), archived))
            .collect()
    } else {
        fs::read_dir(path)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| has_jsonl_extension(path))
            .map(|path| (path, archived))
            .collect()
    }
}

fn extract_payload_text(payload: Option<&Value>) -> String {
    let Some(value) = payload else {
        return String::new();
    };
    if let Some(text) = value.as_str() {
        return text.trim().to_string();
    }
    for key in ["text", "content", "message"] {
        if let Some(text) = extract_value_text(value.get(key)) {
            return text;
        }
    }
    extract_value_text(Some(value)).unwrap_or_default()
}

fn extract_value_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.trim().to_string()).filter(|text| !text.is_empty()),
        Value::Array(items) => {
            let text = items.iter().filter_map(|item| extract_value_text(Some(item))).collect::<Vec<_>>().join("\n");
            Some(text).filter(|text| !text.is_empty())
        }
        Value::Object(map) => {
            for key in ["text", "content", "message"] {
                if let Some(text) = extract_value_text(map.get(key)) {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

fn infer_role(event_type: Option<&str>) -> String {
    let normalized = event_type.unwrap_or("").to_lowercase();
    if normalized.contains("user") {
        "user"
    } else if normalized.contains("assistant") || normalized.contains("agent") {
        "assistant"
    } else if normalized.contains("system") {
        "system"
    } else if normalized.contains("tool") || normalized.contains("function") {
        "tool"
    } else {
        "event"
    }
    .to_string()
}

fn parse_timestamp(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value).ok().map(|time| time.timestamp_millis())
}

fn default_codex_paths() -> Vec<String> {
    dirs::home_dir()
        .map(|home| vec![home.join(".codex").to_string_lossy().to_string()])
        .unwrap_or_default()
}

fn source_id(path: &Path) -> String {
    format!("codex-{}", hash_text(&path.to_string_lossy()))
}

fn hash_text(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn safe_file_stem(value: &str) -> String {
    let stem = value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' })
        .collect::<String>();
    if stem.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        stem
    }
}

fn copy_if_exists(from: &Path, to: &Path) -> CommandResult<()> {
    if from.exists() {
        fs::copy(from, to).map_err(|err| err.to_string())?;
    } else {
        File::create(to).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn event(phase: &str, message: &str, progress: u8) -> ImportEvent {
    ImportEvent {
        phase: phase.to_string(),
        message: message.to_string(),
        progress,
    }
}

fn has_jsonl_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
}
