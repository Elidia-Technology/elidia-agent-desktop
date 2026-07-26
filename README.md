<p align="center">
  <h1 align="center">Elidia Agent Desktop</h1>
  <p align="center"><strong>Native desktop shell for the Elidia agent</strong></p>
  <p align="center">
    macOS · Linux · Windows — with a path to iOS/Android via the same Tauri 2 codebase.
  </p>
</p>

---

## What is this?

Elidia Agent Desktop is **not a rewrite** of [Elidia Agent CLI](https://pypi.org/project/elidia-agent-cli/).
It's a native Tauri 2 shell around the exact same Python `elidia` core — same agent loop, same
36 tools across 11 skill categories, same 4-tier permission system, same RAG store, same
background daemon. Desktop's job is presentation and OS integration (system tray, notifications,
drag-and-drop, voice input, visual dashboards) — not reimplementing what already works and is
already tested in the CLI.

Full plan and architecture flowcharts live in the `AiUtils.io` repo:
- `media/plans/elidia_enterprise/18_ELIDIA_DESKTOP_MASTER_PLAN.md`
- `media/plans/elidia_enterprise/19_ELIDIA_DESKTOP_FLOWCHARTS.md`

## Status

Early scaffolding (Phase 0 — see the master plan §7). Core chat parity, OS integration, visual
surfaces, and packaging are tracked as separate phases, not yet built.

## Development

```bash
npm install
npm run tauri dev      # desktop dev mode
npm run tauri build    # release bundle for the current OS
```

Requires a Rust toolchain (`rustup`) in addition to Node.

## License

Proprietary — Elidia Technology Pvt Ltd. See [LICENSE](LICENSE).
