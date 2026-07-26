use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

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

    let mut count = 0;
    loop {
        let mut line = String::new();
        buf_reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("read: {}", e))?;
        if line.is_empty() {
            break;
        }
        let event: IpcEvent = serde_json::from_str(&line)
            .map_err(|e| format!("JSON decode: {} — raw: {}", e, line))?;
        let done = event.event == "done";
        app_handle
            .emit("chat-event", &event)
            .map_err(|e| format!("emit: {}", e))?;
        count += 1;
        if done {
            break;
        }
    }
    Ok(count)
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![daemon_status, send_chat, list_tools, notify, rag_list_sources, rag_search])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
