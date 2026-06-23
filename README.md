# VoiceHub / 语枢

VoiceHub is a macOS desktop app that turns spoken Chinese development requests into compact, Codex-ready prompts. Hold to talk, release to transcribe and refine, then copy the result into your coding workflow.

## What it does

- Captures push-to-talk audio and provides live recording feedback.
- Transcribes speech with Doubao Seed-ASR.
- Refines the transcript into structured Task, Context, Constraints, and Done when instructions.
- Supports configurable OpenAI-compatible Chat Completions, OpenAI Responses, and Anthropic Messages LLM protocols.
- Keeps the clipboard/copy workflow central, with optional auto-copy and recent prompt history.
- Stores API keys in macOS Keychain after they are applied in the app.
- Includes local diagnostics for ASR, LLM, shortcuts, and clipboard availability.

## Requirements

- macOS
- Node.js 20 or later
- Rust stable toolchain
- Xcode Command Line Tools

## Run locally

```bash
npm install
cp .voicehub.dev.example.json .voicehub.dev.json
npm run tauri dev
```

Fill in your own ASR and LLM credentials in `.voicehub.dev.json`, or configure them in the app. The local development config is ignored by Git and must never be committed.

## Validation

```bash
npm run test:frontend
npm run build
```

## Privacy and security

- API keys are personal credentials. Do not add them to issues, pull requests, screenshots, or source files.
- `.voicehub.dev.json` and `.env` files are ignored by Git.
- Runtime API keys are persisted in macOS Keychain; non-secret settings are kept in the app configuration directory.

## Scope

VoiceHub currently focuses on a deliberate handoff: refine a spoken development request, then copy the resulting prompt into Codex. It does not automatically paste into or control external applications.

## License

This project is licensed under the [MIT License](LICENSE).
