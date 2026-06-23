# 语枢 (VoiceHub) Architecture

> 将开发者的口语化语音意图，翻译为 Codex 最优理解的结构化指令。
> 节省上下文窗口，提升 AI 编码效率。

## Overview
VoiceHub is a Codex-focused voice command refiner for Chinese developers.
It translates spoken intent into compact, Codex-ready Task/Context/Constraints/Done-when instructions.

## Product Direction

VoiceHub focuses on one platform first: Codex.

Current product boundary:

- Optimize spoken Chinese developer intent into prompts that Codex can act on.
- Keep the primary handoff as clipboard/copy workflow until Codex-specific automation is clearly safe.
- Do not build VS Code, Copilot, MCP, or multi-IDE integrations in the near-term roadmap.
- Treat other platforms as future expansion only after the Codex workflow is excellent.

## 4-Layer Pipeline

```
Mic Input
    │
    ▼
[L1] Audio Capture Layer     — src-tauri/src/audio/
     AudioWorklet, 16kHz PCM resampling, 200ms packets, VAD

    │ PCM stream
    ▼
[L2] ASR Recognition Layer   — src-tauri/src/asr/
     Doubao Seed-ASR (current implementation)
     Two-pass recognition, manual hotword injection (default off)

    │ transcript text
    ▼
[L3] AI Refinement Layer     — src-tauri/src/refine/
     Fast path (<500ms): rule engine, filler removal
     Precise path (1-2s): LLM, intent classification, structured output

    │ Codex-ready prompt
    ▼
[L4] Codex Handoff Layer     — Clipboard / copy workflow / Codex-ready templates
```

| Module | Implemented in |
| --- | --- |
| Audio capture | W-02 |
| Doubao ASR | W-03 |
| Hotword system | W-04 |
| Dual-pipeline refiner + intent classifier | W-05 |
| Codex Prompt copy workflow | W-06 |
| Codex Prompt template system | W-07 |
| Prompt history and reuse | W-08 |
| Desktop UI polish | W-09 |
| Global hold-to-talk shortcut | W-10 |
| Security/privacy | W-11 |

## W-06 Handoff

W-06 completes the frontend Codex Prompt copy workflow:

- Manual copy button with copied/failed feedback.
- Visible Codex-ready Prompt can be cleared manually without clearing history.
- Optional auto-copy with visible success/failure status.
- Previous valid Codex Prompt remains available while the next recording is processing.
- Low-confidence non-development speech does not expose or auto-copy an empty prompt.
- Press-and-hold recording ends on release; silence VAD does not end recording in this mode.
- Default hotword injection is off until the Doubao hotword object format is fixed.

Before W-07, manually verify one valid development command with an LLM key set in the launch terminal.

## Development Config

For local development, copy `.voicehub.dev.example.json` to `.voicehub.dev.json` and fill in local keys.

`.voicehub.dev.json` is ignored by git. On startup, the frontend first reads the user's persisted runtime config. If no persisted ASR or LLM config exists yet, it falls back to `.voicehub.dev.json` for local bootstrap.

Runtime config persistence is split by sensitivity:

- ASR and LLM API keys are saved in macOS Keychain.
- Non-secret fields such as ASR endpoint/resource ID and LLM API base/model/protocol/provider are saved in the app config directory.

## W-07 Codex Prompt Templates

W-07 improves Codex prompt quality rather than integrating other platforms.

Completed scope:

- Compact Codex-ready task cards using only Task, Context, Constraints, Done when, and low-confidence Original fields.
- Cleaner prompt rendering that omits empty fields and weak voice-receipt completion text.
- Low-confidence non-development speech is suppressed instead of copied as a Codex task.
- Existing copy and auto-copy workflow remains the handoff path.

- `src-tauri/src/refine/templates.rs` renders compact Codex prompts.
- Empty structured fields are omitted from the rendered prompt.
- Shared Codex rules and generic intent-specific advice are not repeated in every usable prompt.
- Template behavior has focused Rust unit coverage for compact rendering, empty-field omission, low-confidence suppression, and weak Done-when filtering.

Out of scope for W-07:

- VS Code extensions.
- Copilot Chat insertion.
- MCP servers.
- Automatic cross-app control.

## W-08 Prompt History and Reuse

W-08 keeps the handoff path focused on Codex-ready prompts.

Completed scope:

- Generated usable Codex Prompts are added to a recent in-session history.
- The history keeps the latest 5 prompts and skips consecutive duplicates.
- A history item can be reused as the current Codex-ready Prompt.
- The in-session history can be cleared manually.
- Prompt history can optionally be kept across restarts on the same machine.
- Existing manual copy and auto-copy behavior remains unchanged.

Out of scope for W-08:

- Cloud sync or cross-device prompt persistence.
- Prompt search, tagging, or folders.
- Automatic insertion into Codex or other apps.

## W-09 Desktop UI Polish

W-09 makes the desktop app easier to use without changing the ASR or refinement pipeline.

Completed scope:

- Move ASR, LLM, and hotword controls into a collapsible configuration area.
- Collapse legacy Doubao App Key and Access Key fields by default while preserving submit behavior.
- Add LLM provider/model presets that fill API Base, Model, and runtime protocol while keeping manual editing available.
- Keep the recording action, auto-copy toggle, and result panel as the primary desktop workflow.
- Add a shared frontend stylesheet for basic layout, spacing, and responsive behavior.
- Preserve existing copy, auto-copy, prompt history, ASR, and refinement behavior.

Out of scope for W-09:

- New ASR protocol behavior.
- New Codex handoff automation.
- Cross-restart settings or prompt persistence.

## W-10 Global Hold-To-Talk Trigger

W-10 adds a configurable hold-to-talk desktop trigger while preserving the existing ASR and refinement pipeline.

Completed scope:

- Register a global keyboard shortcut through the Tauri global-shortcut plugin.
- Capture the next keyboard key, keyboard combo, or mouse side/custom button after the trigger input is focused.
- Use Tauri global-shortcut for keyboard triggers.
- Use a macOS CoreGraphics event tap for mouse side/custom button triggers.
- Pressing the active trigger starts the existing recording flow; releasing it stops recording.
- Triggered recording enables the existing auto-copy handoff.
- The UI exposes trigger setting and registration status.
- The selected trigger key and enabled state are restored locally on restart.

Out of scope for W-10:

- Automatic paste or control of Codex.
- Syncing shortcut settings across machines.
- Changes to Doubao ASR, audio capture format, or LLM refinement behavior.

## W-11 Runtime Config and Privacy

W-11 keeps sensitive runtime settings usable without writing API keys to plain app storage.

Completed scope:

- Load development ASR/LLM config from ignored `.voicehub.dev.json` for local runs.
- Save ASR and LLM API keys in macOS Keychain after the user applies them.
- Save non-secret ASR/LLM fields in the app config directory.
- Restore persisted ASR/LLM config on startup, using development config only when persisted config is absent.
- Keep legacy Doubao credentials optional and collapsed by default.
- Support OpenAI-compatible Chat Completions, OpenAI Responses, and Anthropic Messages protocol selection from the LLM preset UI.

Out of scope for W-11:

- Automatic paste or remote control of Codex.

## Current UI Notes

The current desktop UI includes a few lightweight helpers around the core voice workflow:

- A first-run guide that points the user to the next missing setup step.
- A local diagnostics panel for checking ASR credentials, LLM credentials, shortcut state, prompt history mode, and clipboard availability.
- An editable Codex-ready Prompt area where manual copy uses the edited text rather than the original generated text.
- A manual-copy fallback that exposes a selectable textarea when clipboard write fails.
- A small developer-only manual text refinement panel for validating prompt behavior without recording audio.
- A recent-results panel where the latest 5 prompts can be reused or copied directly.

Not currently implemented:

- Whisper.cpp or another offline ASR fallback wired into the shipped desktop flow.
- Automatic cross-app insertion, paste, or remote control of Codex.
