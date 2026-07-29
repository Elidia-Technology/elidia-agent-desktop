# Elidia Agent Desktop — v0.2.2

Native desktop app (Tauri 2) wrapping the Elidia CLI engine. macOS, Linux, Windows.

## Download
| Platform | Download |
|---|---|
| macOS | [Elidia Agent_0.2.2_x64.dmg](https://github.com/Elidia-Technology/elidia-agent-desktop/releases/latest) (13MB) |
| Linux (.deb/.rpm) | [CI Build](https://github.com/Elidia-Technology/elidia-agent-desktop/actions) |
| Windows (.msi) | [CI Build](https://github.com/Elidia-Technology/elidia-agent-desktop/actions) |

## Requirements
- [Elidia CLI](https://pypi.org/project/elidia-agent-cli/) installed

## Features
- 50 LLMs via daemon — same engine as CLI (v0.6)
- 6 modes: Chat, Code, Research, Think, Create, MoA
- 141+ portal AI tools accessible through chat
- 9 panels: RAG, Daemon, Audit, Workflow, Advanced (MoA), Learning, Settings (Skills+Gateway), Info
- File upload (drag & drop, 10 files max)
- Screenshot capture for instant vision analysis
- All v0.6 engine features via daemon IPC

## Dev
```bash
npm install && npm run tauri dev
npm run tauri build
```
