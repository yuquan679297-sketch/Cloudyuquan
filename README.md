# VoiceHub / 语枢

[![CI](https://github.com/yuquan679297-sketch/Cloudyuquan/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yuquan679297-sketch/Cloudyuquan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-6d5cff.svg)](LICENSE)

[English](README.md) | [简体中文](README.zh-CN.md)

> 将中文开发语音整理为可直接交给 Codex 的结构化 Prompt。

VoiceHub / 语枢是一款面向中文开发者的 macOS 桌面应用：按住说话、松开识别，通过 LLM 整理成结构化 Prompt，确认后复制到 Codex 工作流。完整中文说明见 [README.zh-CN.md](README.zh-CN.md)。

VoiceHub is a macOS desktop app for Chinese-speaking developers. Hold to talk, release to transcribe, refine the result with an LLM, review it, and copy a compact Codex-ready instruction into your coding workflow.

The project intentionally keeps the last step human-controlled: VoiceHub refines and copies prompts, but does not automatically paste into or control Codex, an IDE, or another application.

## Contents

- [Why VoiceHub](#why-voicehub)
- [Core workflow](#core-workflow)
- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Daily use](#daily-use)
- [Development](#development)
- [Privacy and security](#privacy-and-security)
- [Scope and roadmap](#scope-and-roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why VoiceHub

Voice input is fast, but raw speech is often too vague for a coding agent. VoiceHub turns a spoken request such as "帮我查一下页面白屏，别重构，给最小修复" into a focused prompt with an explicit task, relevant context, constraints, and a completion condition.

It is designed for developers who want to keep their existing editor and Codex workflow while reducing the friction between an idea and a clear implementation request.

## Core workflow

```mermaid
flowchart LR
  A[Hold to talk] --> B[Audio capture]
  B --> C[Doubao Seed-ASR]
  C --> D[Rule cleanup and LLM refinement]
  D --> E[Review refined or raw text]
  E --> F[Copy Codex-ready prompt]
```

## Features

- Push-to-talk recording with live audio-level feedback and workflow states.
- Doubao Seed-ASR transcription with configurable endpoint and resource ID.
- Fast rule-based cleanup followed by configurable LLM refinement.
- OpenAI-compatible Chat Completions, OpenAI Responses, and Anthropic Messages protocol support.
- Refined/raw result switching, Markdown preview, editable output, and clear copy feedback.
- Optional automatic copy and a local recent-prompt history.
- Global keyboard or mouse trigger support on macOS.
- A configuration drawer with ASR, LLM, shortcut, clipboard, and diagnostic status.
- Local API-key storage through macOS Keychain after configuration is applied.

## Requirements

- macOS
- Node.js 20 LTS or later
- Rust stable toolchain
- Xcode Command Line Tools
- Your own ASR and LLM provider credentials

VoiceHub calls the ASR and LLM providers you configure. Their availability, pricing, and data-handling terms are independent of this repository.

## Quick start

```bash
git clone https://github.com/yuquan679297-sketch/Cloudyuquan.git
cd Cloudyuquan
npm ci
cp .voicehub.dev.example.json .voicehub.dev.json
npm run tauri dev
```

Fill in local credentials in `.voicehub.dev.json`, or open the app and configure ASR and LLM settings there. The local config file is ignored by Git and must never be committed.

For detailed field descriptions and first-run guidance, see [Configuration guide](docs/configuration.md).

## Configuration

VoiceHub needs two services:

1. An ASR service for speech-to-text. The current implementation targets Doubao Seed-ASR.
2. An LLM service for converting a transcript into a structured development prompt.

The checked-in [development config example](.voicehub.dev.example.json) contains placeholders only. Add your own keys locally, never to source control.

Runtime behavior:

- API keys applied through the app are stored in macOS Keychain.
- Non-secret fields such as endpoints, models, and protocol selections are stored in the app configuration directory.
- `.voicehub.dev.json` is a local bootstrap fallback when persisted runtime configuration is absent.

## Daily use

1. Open the configuration drawer and finish ASR and LLM setup.
2. Hold the main recording button or your configured global trigger while speaking.
3. Release it and wait for recognition and refinement to finish.
4. Review the refined Prompt, or switch to raw recognition when you need to inspect the original transcript.
5. Copy the result manually, or enable auto-copy after verifying that behavior fits your workflow.

The recent-prompt panel is local to your machine. It is not cloud-synced.

## Development

Install dependencies and run the desktop app:

```bash
npm ci
npm run tauri dev
```

Run the checks used by local development and GitHub Actions:

```bash
npm run test:frontend
npm run build
```

The project is a Tauri 2 desktop app with a React and TypeScript frontend plus a Rust backend. See [ARCHITECTURE.md](ARCHITECTURE.md) for the pipeline and product boundary.

## Privacy and security

- Do not add API keys, access tokens, passwords, or real user transcripts to issues, pull requests, screenshots, or commits.
- `.voicehub.dev.json`, `.env`, generated dependencies, and build artifacts are ignored by Git.
- Before sharing logs, redact credentials and personally identifying content.
- Report a security issue according to [SECURITY.md](SECURITY.md), not through a public issue with sensitive details.

## Scope and roadmap

Current scope:

- macOS desktop workflow for Chinese development voice requests.
- ASR, LLM refinement, local history, diagnostics, and clipboard handoff.
- Codex-ready prompt generation with a user-controlled final copy action.

Not currently provided:

- Offline ASR fallback in the shipped workflow.
- Automatic paste, IDE control, or cross-application remote control.
- Cloud sync, shared prompt libraries, or team administration.
- Signed and notarized downloadable macOS releases.

The next release work should focus on reliability, configuration clarity, and reproducible desktop packaging before adding new integrations.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change, and use the issue templates to include reproducible information without sharing secrets.

## License

VoiceHub is released under the [MIT License](LICENSE).
