# CLAUDE.md — Elidia Agent Desktop

## Project
Native desktop shell (Tauri 2) for the Elidia agent — macOS, Linux, Windows, with a path to
iOS/Android via the same Tauri 2 codebase (`tauri android init` / `tauri ios init`).
This is a **separate project** from `elidia-cli` and from the `AiUtils.io` portal — independent
source code, build, and distribution. It wraps the `elidia-agent-cli` Python core unchanged;
it does not reimplement the agent loop, tools, permissions, RAG, or MCP client.

Plan + flowcharts live in the `AiUtils.io` repo:
`media/plans/elidia_enterprise/18_ELIDIA_DESKTOP_MASTER_PLAN.md`
`media/plans/elidia_enterprise/19_ELIDIA_DESKTOP_FLOWCHARTS.md`

## Stack
- Tauri 2 (Rust core + system WebView)
- React 19 + TypeScript, Vite
- Backend: the existing `elidia` Python package (from `elidia-cli`), run as a subprocess-managed
  daemon — communication over the extended `DaemonIPCServer` (Unix socket / named pipe on
  Windows), not gRPC. See the master plan §3.1 for why.

## Source control
- **GitLab (primary, origin):** all source code, versioning, CI/CD —
  `ssh://git@git.aiutils.io:2222/Saleem/elidia-agent-desktop.git`
- **GitHub (public, developer builds only):** mirrors `elidia-cli`'s pattern — build/download/docs
  only, never a source mirror, once set up.

## Build / dev
```bash
npm install
npm run tauri dev      # desktop dev mode (opens a window)
npm run tauri build     # release bundle for the current OS
```
Rust toolchain required (`rustup`). Mobile targets need `npm run tauri android init` /
`npm run tauri ios init` — Android additionally needs the Android SDK/NDK (not assumed
present; verify before claiming a mobile build works).

## Features (as of 2026-07-28)

### UI
- Title bar with app icon + daemon status (visible when maximized)
- Icon toolbar with lucide-react icons + tooltips (29 toolbar actions)
- Left sidebar: sessions with +New Chat
- Right sidebar: 8 toggleable panels (RAG, Daemon, Audit, Workflow, Advanced, Learning, Settings, Info)
- Light theme (default) + Dark theme toggle (persisted)
- Model selector: 50 LLMs grouped by vendor with optgroup

### Panels
- **Learning Dashboard** (new): 3 tabs — Performance (model rankings), Knowledge (entity search), Patterns (failure analysis)
- **RAG Manager**: Local document indexing
- **Daemon Dashboard**: Watchers, schedules, webhooks
- **Audit Log**: Tool call audit trail
- **Workflow Builder**: YAML workflow editor
- **Settings**: API keys, thinking level, budget

### File Upload
- Drag & drop + file picker (📎 button)
- Non-executable files: PDF, DOC/DOCX, PPT/PPTX, CSV, TXT, XLS/XLSX, images, code
- Image optimization via daemon (resize >1024×1024, WebP, LANCZOS)
- Attachment preview bar with remove × button
- Max 10 files, voice input (🎤), screenshot capture (📸)

### Agent Features (via Python daemon)
- 5 conversation modes: chat, code, research, think, create (CLI modes: DIRECT, CONSENSUS, HARNESS, DEEP, SWARM)
- Self-learning: OutcomeTracker + PatternLearner + KnowledgeGraph
- Research: 5-stage pipeline with source-verified citations
- 29 CLI slash commands accessible via daemon IPC

## Build Status (verified 2026-07-28)
- macOS x86_64: ✅ Built (Elidia Agent_0.2.1_x64.dmg)
- Linux: ⚠️ Configured, not built on this machine
- Windows: ⚠️ Configured, not built on this machine
- Android: ⚠️ Init done, not built
- iOS: ⚠️ Init failed (CocoaPods issue, not project config)

## Rules

## Mobile targets (Android + iOS)

Tauri 2 supports `npm run tauri android dev` and `npm run tauri ios dev` directly from this
project structure — the `tauri.conf.json` is already configured for both. What's verified
vs. not on this specific machine (`macOS 26.5`):

- **Android:** `tauri android init` succeeded — Android Studio is installed, the SDK lives at
  `~/Library/Android/sdk` (not in the default shell PATH, but Tauri's own discovery finds it),
  NDK 27.1 is present, 4 Rust Android targets are installed. A full `tauri android build` has
  NOT been attempted on this machine yet — the Gradle project exists in `src-tauri/gen/android/`
  but has not been compiled.
- **iOS:** Xcode 16 is installed. `tauri ios init` failed mid-way due to a local homebrew issue
  (`brew reinstall cocoapods` hit a Ruby 4.0.6 symlink error) — the project config is correct;
  the init needs the homebrew fix on this machine before cocoapods can be installed. Not a
  project-configuration gap.

## Company
Elidia Technology Pvt Ltd. Proprietary license. See LICENSE file.
