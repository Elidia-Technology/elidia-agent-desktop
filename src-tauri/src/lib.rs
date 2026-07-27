use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{oneshot, Mutex};

/// Shared state for the permission IPC round-trip (AIUT-2148).
/// When the daemon blocks on a permission check, the Desktop's
/// send_chat poller detects the pending request, stores a oneshot
/// sender here, and waits. The respond_permission command looks
/// up the sender and resolves it with the user's choice.
struct PermissionState {
    pending: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

// ---- daemon socket discovery ----

/// Computes the daemon's Unix socket path using the exact same algorithm as
/// Python's `elidia.daemon.worker._short_socket_path()` — SHA-256 of the
/// resolved ELIDIA_HOME, first 12 hex chars, placed in the system temp dir.
/// This is what lets two separate processes (the Desktop app and any `elidia
/// daemon status` CLI invocation) find the same running daemon without
/// hardcoding a path or introducing a separate discovery protocol.
fn daemon_socket_path() -> PathBuf {
    let elidia_home = std::env::var("ELIDIA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(".elidia")
        });
    let resolved = std::fs::canonicalize(&elidia_home).unwrap_or(elidia_home);
    let hash = Sha256::digest(resolved.to_string_lossy().as_bytes());
    let hash_hex = format!("{:x}", hash);
    std::env::temp_dir().join(format!("elidia-daemon-{}", &hash_hex[..12]))
}

// ---- JSON types (mirrors Python's daemon IPC protocol) ----

#[derive(Debug, Serialize, Deserialize)]
struct IpcRequest {
    cmd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    messages: Option<Vec<ChatMessage>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct IpcEvent {
    event: String,
    #[serde(default)]
    data: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DaemonStatus {
    running: bool,
    #[serde(default)]
    task_count: usize,
    #[serde(default)]
    active_tasks: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ToolInfo {
    name: String,
    description: String,
    category: String,
}

// ---- low-level IPC helpers ----

async fn ipc_send_recv(request: &IpcRequest) -> Result<Value, String> {
    let socket = daemon_socket_path();
    let stream = UnixStream::connect(&socket)
        .await
        .map_err(|e| format!("Daemon not running ({}: {})", socket.display(), e))?;

    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);

    let payload =
        serde_json::to_string(request).map_err(|e| format!("JSON encode: {}", e))?;
    writer
        .write_all(format!("{}\n", payload).as_bytes())
        .await
        .map_err(|e| format!("write: {}", e))?;

    let mut line = String::new();
    buf_reader
        .read_line(&mut line)
        .await
        .map_err(|e| format!("read: {}", e))?;

    if line.is_empty() {
        return Err("Daemon closed connection without responding".into());
    }
    serde_json::from_str(&line).map_err(|e| format!("JSON decode: {} — raw: {}", e, line))
}

// ---- Tauri commands (exposed to the React frontend via invoke()) ----

#[tauri::command]
async fn daemon_status() -> Result<DaemonStatus, String> {
    let request = IpcRequest {
        cmd: "status".into(),
        messages: None,
        mode: None,
        model: None,
        session_id: None,
    };
    let response = ipc_send_recv(&request).await?;
    if !response
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Err(response
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown daemon error")
            .into());
    }
    let status: DaemonStatus = serde_json::from_value(response["status"].clone())
        .map_err(|e| format!("parse status: {}", e))?;
    Ok(status)
}

#[tauri::command]
async fn list_tools() -> Result<Vec<ToolInfo>, String> {
    let request = IpcRequest {
        cmd: "list_tools".into(),
        messages: None,
        mode: None,
        model: None,
        session_id: None,
    };
    let response = ipc_send_recv(&request).await?;
    if !response
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Err(response
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown daemon error")
            .into());
    }
    let tools: Vec<ToolInfo> = serde_json::from_value(response["tools"].clone())
        .map_err(|e| format!("parse tools: {}", e))?;
    Ok(tools)
}

/// Streaming chat — the core command. Opens a Unix socket to the daemon,
/// sends a {"cmd":"chat",...} request, then reads newline-delimited JSON
/// lines. Each line becomes a Tauri event emitted to the "chat-event"
/// listener on the frontend. Returns the number of events received.
#[tauri::command]
async fn send_chat(
    app_handle: tauri::AppHandle,
    message: String,
    mode: Option<String>,
    model: Option<String>,
) -> Result<i32, String> {
    let socket = daemon_socket_path();
    let stream = UnixStream::connect(&socket)
        .await
        .map_err(|e| format!("Daemon not running ({}: {})", socket.display(), e))?;

    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);

    let request = IpcRequest {
        cmd: "chat".into(),
        messages: Some(vec![ChatMessage {
            role: "user".into(),
            content: message,
        }]),
        mode: Some(mode.unwrap_or_else(|| "chat".into())),
        model,
        session_id: None,
    };

    let payload =
        serde_json::to_string(&request).map_err(|e| format!("JSON encode: {}", e))?;
    writer
        .write_all(format!("{}\n", payload).as_bytes())
        .await
        .map_err(|e| format!("write: {}", e))?;

    let perm_state: tauri::State<'_, PermissionState> = app_handle.state();
    let mut count = 0;
    loop {
        let mut line = String::new();
        match tokio::time::timeout(tokio::time::Duration::from_secs(1), buf_reader.read_line(&mut line)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(_)) => {
                let event: IpcEvent = serde_json::from_str(&line)
                    .map_err(|e| format!("JSON decode: {} — raw: {}", e, line))?;
                let done = event.event == "done";
                app_handle.emit("chat-event", &event).map_err(|e| format!("emit: {}", e))?;
                count += 1;
                if done { break; }
            }
            Ok(Err(e)) => return Err(format!("read: {}", e)),
            Err(_) => {
                if let Ok(Some(req_id)) = check_pending_permissions(&socket).await {
                    let (tx, rx) = oneshot::channel();
                    perm_state.pending.lock().await.insert(req_id.clone(), tx);
                    app_handle.emit("permission-request", serde_json::json!({"id": req_id}))
                        .map_err(|e| format!("emit: {}", e))?;
                    match rx.await {
                        Ok(approved) => {
                            ipc_with_body(serde_json::json!({"cmd":"permission_response","id":req_id,"approved":approved})).await?;
                        }
                        Err(_) => return Err("Permission request cancelled".into()),
                    }
                }
            }
        }
    }
    Ok(count)
}

#[tauri::command]
async fn respond_permission(state: tauri::State<'_, PermissionState>, id: String, approved: bool) -> Result<(), String> {
    let mut pending = state.pending.lock().await;
    if let Some(tx) = pending.remove(&id) {
        tx.send(approved).map_err(|_| "already resolved".into())
    } else {
        Err(format!("no pending permission with id={}", id))
    }
}

async fn check_pending_permissions(socket: &PathBuf) -> Result<Option<String>, String> {
    let stream = UnixStream::connect(socket).await.map_err(|e| format!("poll: {}", e))?;
    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);
    writer.write_all(b"{\"cmd\":\"pending_permissions\"}\n").await.map_err(|e| format!("w: {}", e))?;
    let mut line = String::new();
    buf_reader.read_line(&mut line).await.map_err(|e| format!("r: {}", e))?;
    let resp: Value = serde_json::from_str(&line).map_err(|e| format!("json: {}", e))?;
    let pending: Vec<Value> = resp.get("pending").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(pending.first().and_then(|p| p.get("id")).and_then(|v| v.as_str()).map(String::from))
}

#[tauri::command]
async fn rag_list_sources() -> Result<String, String> {
    let request = IpcRequest {
        cmd: "rag_list_sources".into(),
        messages: None, mode: None, model: None, session_id: None,
    };
    let response = ipc_send_recv(&request).await?;
    Ok(response
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("No data")
        .to_string())
}

#[tauri::command]
async fn rag_search(query: String, limit: Option<i32>) -> Result<String, String> {
    // rag_search needs special handling — the IPC request shape differs
    let socket = daemon_socket_path();
    let stream = UnixStream::connect(&socket)
        .await
        .map_err(|e| format!("Daemon not running ({}: {})", socket.display(), e))?;
    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);

    let payload = serde_json::json!({
        "cmd": "rag_search",
        "query": query,
        "limit": limit.unwrap_or(5),
    });
    writer
        .write_all(format!("{}\n", payload).as_bytes())
        .await
        .map_err(|e| format!("write: {}", e))?;

    let mut line = String::new();
    buf_reader
        .read_line(&mut line)
        .await
        .map_err(|e| format!("read: {}", e))?;
    let response: Value = serde_json::from_str(&line)
        .map_err(|e| format!("JSON decode: {}", e))?;
    Ok(response
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("No results")
        .to_string())
}

#[tauri::command]
async fn get_daemon_config() -> Result<Value, String> {
    let request = IpcRequest {
        cmd: "get_daemon_config".into(),
        messages: None, mode: None, model: None, session_id: None,
    };
    ipc_send_recv(&request).await
}

#[tauri::command]
async fn get_audit_log(limit: Option<i32>) -> Result<Value, String> {
    let socket = daemon_socket_path();
    let stream = UnixStream::connect(&socket)
        .await
        .map_err(|e| format!("Daemon not running: {}", e))?;
    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);
    let payload = serde_json::json!({"cmd":"get_audit_log","limit":limit.unwrap_or(40)});
    writer.write_all(format!("{}\n", payload).as_bytes()).await.map_err(|e| format!("write: {}", e))?;
    let mut line = String::new();
    buf_reader.read_line(&mut line).await.map_err(|e| format!("read: {}", e))?;
    serde_json::from_str(&line).map_err(|e| format!("JSON: {}", e))
}

#[tauri::command]
async fn workflow_run(yaml: String) -> Result<Value, String> {
    let socket = daemon_socket_path();
    let stream = UnixStream::connect(&socket)
        .await
        .map_err(|e| format!("Daemon not running: {}", e))?;
    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);
    let payload = serde_json::json!({"cmd":"workflow_run","yaml":yaml});
    writer.write_all(format!("{}\n", payload).as_bytes()).await.map_err(|e| format!("write: {}", e))?;
    let mut line = String::new();
    buf_reader.read_line(&mut line).await.map_err(|e| format!("read: {}", e))?;
    serde_json::from_str(&line).map_err(|e| format!("JSON: {}", e))
}

#[tauri::command]
async fn get_balance() -> Result<Value, String> {
    ipc_send_recv(&IpcRequest { cmd: "get_balance".into(), messages: None, mode: None, model: None, session_id: None }).await
}
#[tauri::command]
async fn get_session_messages(session_id: String) -> Result<Value, String> {
    ipc_with_body(serde_json::json!({"cmd":"get_session_messages","session_id":session_id})).await
}

#[tauri::command]
async fn list_mcp_servers() -> Result<Value, String> {
    ipc_send_recv(&IpcRequest { cmd: "list_mcp_servers".into(), messages: None, mode: None, model: None, session_id: None }).await
}
#[tauri::command]
async fn list_personas() -> Result<Value, String> {
    ipc_send_recv(&IpcRequest { cmd: "list_personas".into(), messages: None, mode: None, model: None, session_id: None }).await
}
#[tauri::command]
async fn list_models() -> Result<Value, String> {
    ipc_send_recv(&IpcRequest { cmd: "list_models".into(), messages: None, mode: None, model: None, session_id: None }).await
}
#[tauri::command]
async fn search_memory(query: Option<String>, limit: Option<i32>) -> Result<Value, String> {
    ipc_with_body(serde_json::json!({"cmd":"search_memory","query":query.unwrap_or_default(),"limit":limit.unwrap_or(20)})).await
}
#[tauri::command]
async fn forget_memory(key: String) -> Result<Value, String> {
    ipc_with_body(serde_json::json!({"cmd":"forget_memory","key":key})).await
}
#[tauri::command]
async fn get_trust_stats() -> Result<Value, String> {
    ipc_send_recv(&IpcRequest { cmd: "get_trust_stats".into(), messages: None, mode: None, model: None, session_id: None }).await
}

async fn ipc_with_body(body: Value) -> Result<Value, String> {
    let socket = daemon_socket_path();
    let stream = UnixStream::connect(&socket).await.map_err(|e| format!("Daemon not running: {}", e))?;
    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);
    writer.write_all(format!("{}\n", body).as_bytes()).await.map_err(|e| format!("write: {}", e))?;
    let mut line = String::new();
    buf_reader.read_line(&mut line).await.map_err(|e| format!("read: {}", e))?;
    serde_json::from_str(&line).map_err(|e| format!("JSON: {}", e))
}

#[tauri::command]
async fn start_research(app_handle: tauri::AppHandle, question: String) -> Result<i32, String> {
    let socket = daemon_socket_path();
    let stream = UnixStream::connect(&socket).await.map_err(|e| format!("Daemon not running: {}", e))?;
    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);
    let payload = serde_json::json!({"cmd":"research_start","question":question});
    writer.write_all(format!("{}\n", payload).as_bytes()).await.map_err(|e| format!("write: {}", e))?;
    let mut count = 0;
    loop {
        let mut line = String::new();
        buf_reader.read_line(&mut line).await.map_err(|e| format!("read: {}", e))?;
        if line.is_empty() { break; }
        let event: IpcEvent = serde_json::from_str(&line).map_err(|e| format!("JSON: {}", e))?;
        let done = event.event == "done";
        app_handle.emit("research-event", &event).map_err(|e| format!("emit: {}", e))?;
        count += 1;
        if done { break; }
    }
    Ok(count)
}

// Screen capture: tauri-plugin-screenshots v2.2.0. No npm wrapper needed —
// the take_screenshot Tauri command calls the Rust API directly.
// Voice dictation: uses the Web Speech API built into the Tauri webview
// (no plugin needed) — see App.tsx voice button.

// File picker and clipboard: both use the Tauri webview's JS API
// (navigator.clipboard, <input type=file>) rather than the Rust plugin
// API which has trait-resolution issues with tauri-plugin-clipboard 2.x.
// The React frontend handles both via browser APIs directly in App.tsx.

#[tauri::command]
async fn paste_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let clipboard = app.state::<tauri_plugin_clipboard::Clipboard>();
    if !clipboard.has_image().unwrap_or(false) {
        return Ok(None);
    }
    let bytes = clipboard.read_image_binary().map_err(|e| format!("read: {}", e))?;
    let dir = std::env::temp_dir().join("elidia-clipboard");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {}", e))?;
    let path = dir.join("pasted.png");
    std::fs::write(&path, &bytes).map_err(|e| format!("write: {}", e))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn take_screenshot(app: tauri::AppHandle) -> Result<String, String> {
    let monitors = tauri_plugin_screenshots::get_screenshotable_monitors()
        .await
        .map_err(|e| format!("monitors: {}", e))?;
    let primary = monitors.into_iter().next().ok_or("no monitors found")?;
    let path = tauri_plugin_screenshots::get_monitor_screenshot(app, primary.id)
        .await
        .map_err(|e| format!("capture: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| format!("notification: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_screenshots::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_clipboard::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("CmdOrCtrl+Shift+E")
                .expect("valid shortcut")
                .with_handler(|app, _shortcut, _event| {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                })
                .build(),
        )
        .setup(|app| {
            // ---- tray icon with menu ----
            let show = MenuItemBuilder::with_id("show", "Show").build(app)?;
            let status_item = MenuItemBuilder::with_id("status", "Daemon: checking…").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show)
                .item(&status_item)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ---- minimize to tray on close (AIUT-2150) ----
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            Ok(())
        })
        .manage(PermissionState { pending: Mutex::new(HashMap::new()) })
        .invoke_handler(tauri::generate_handler![daemon_status, send_chat, list_tools, notify, take_screenshot, paste_image, respond_permission, rag_list_sources, rag_search, get_daemon_config, get_audit_log, workflow_run, get_balance, get_session_messages, list_mcp_servers, list_personas, list_models, search_memory, forget_memory, get_trust_stats, start_research])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
