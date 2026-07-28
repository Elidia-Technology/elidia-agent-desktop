# Changelog

## [0.1.0] - 2026-07-28

### Added
- Native Tauri 2 desktop app (macOS, Linux, Windows)
- Official Elidia Agent branding — icon, name, company (Elidia Technology Pvt Ltd, New Delhi)
- 147 AI tools shared with CLI via daemon IPC
- Chat panel with streaming AgentEvents (content/tool_call/tool_result/thinking)
- System tray icon with quick actions (Show, Daemon status, Quit)
- Native OS notifications
- Global hotkey (Cmd+Shift+E)
- Drag-and-drop files/images
- Screen capture → automatic vision
- Voice dictation (Web Speech API)
- Clipboard paste-image
- Auto-launch at login + minimize-to-tray
- Visual RAG document manager
- Visual workflow builder (YAML round-trip with CLI)
- Permission & trust dashboard with audit log browser
- Daemon config dashboard (watchers, schedules, webhooks, coding tasks)
- Session sidebar with history search
- 6-tab Info panel (Memory, MCP, Personas, Models, Trust, Balance)
- 2-tab Advanced panel (Research pipeline, Creative tools)
- First-run onboarding wizard
- Auto-updater
- Crash reporting (panic hook)
- 331/331 tests pass (shared CLI test suite)
- macOS .dmg (12MB) + Ubuntu .deb (9.9MB) + Fedora .rpm (9.9MB) installers

### Builds
- macOS: Apple Silicon + Intel universal binary
- Linux: Ubuntu 22.04+ (.deb), Fedora 38+ (.rpm)
- Windows: coming via CI pipeline
- iOS + Android: scaffolded (Gradle + Xcode), beta soon
