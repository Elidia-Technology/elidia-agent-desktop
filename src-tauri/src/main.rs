// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 3 && args[1] == "--headless" {
        let prompt = args[2..].join(" ");
        let mode = std::env::var("ELIDIA_MODE").unwrap_or_else(|_| "chat".into());
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        match rt.block_on(elidia_agent_desktop_lib::headless_chat(prompt, Some(mode))) {
            Ok(response) => {
                println!("{}", response);
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("Error: {}", e);
                std::process::exit(1);
            }
        }
    }
    // JSON output mode for CI pipelines
    if args.len() >= 3 && args[1] == "--headless-json" {
        let prompt = args[2..].join(" ");
        let mode = std::env::var("ELIDIA_MODE").unwrap_or_else(|_| "chat".into());
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let result = rt.block_on(elidia_agent_desktop_lib::headless_chat(prompt, Some(mode)));
        let ok = result.is_ok();
        let msg = result.unwrap_or_default();
        println!("{}", serde_json::json!({"ok":ok,"response":msg}));
        std::process::exit(if ok {0} else {1});
    }
    elidia_agent_desktop_lib::run()
}
