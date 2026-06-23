# Configuration Guide

VoiceHub needs an ASR provider to turn audio into text and an LLM provider to refine that text into a coding prompt. Each provider account and API key belongs to the user running the app.

## First-run setup

1. Start the app with `npm run tauri dev`.
2. Open the configuration drawer from the top status area.
3. Configure ASR and LLM sections with your provider credentials.
4. Use the diagnostic cards to confirm the fields and shortcut state.
5. Record a short development request and review the result before enabling automatic copy.

For local development, create a local bootstrap config:

```bash
cp .voicehub.dev.example.json .voicehub.dev.json
```

The resulting file is ignored by Git. Keep it local.

## ASR fields

| Field | Purpose |
| --- | --- |
| API Key | Credential for the ASR provider. |
| Resource ID | Provider resource or model identifier required by the ASR endpoint. |
| Endpoint | WebSocket endpoint used for recognition. It should start with `wss://` in normal hosted use. |
| App Key / Access Key | Legacy Doubao fields. Leave them empty unless your provider setup specifically requires them. |

The current ASR path is designed for Doubao Seed-ASR. Provider account setup, quotas, and endpoint permissions are managed by the provider.

## LLM fields

| Field | Purpose |
| --- | --- |
| API Key | Credential for the LLM provider. |
| API Base | Base URL for the provider API. |
| Model | The model name accepted by that endpoint. |
| Protocol | Request format: OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages. |

Preset selection can fill compatible base URLs, models, and protocols. You can still enter a custom compatible endpoint manually.

## Credential storage

- Keys saved through the app are stored in macOS Keychain.
- Non-secret settings are stored in the app configuration directory.
- The development JSON file is read only as a fallback when persisted runtime configuration is absent.
- `.env.example` is a placeholder reference and contains no live credentials. Do not create or commit a real `.env` file in this repository.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Recording does not start | Grant microphone permission to the app in macOS Privacy & Security settings. |
| Global mouse trigger does not work | Grant Accessibility permission, then reopen or re-register the trigger. |
| ASR does not connect | Confirm API key, resource ID, and that the endpoint is a WebSocket URL. |
| LLM request fails | Confirm API key, API base, model, protocol, and provider account quota. |
| Copy fails | Use the selectable fallback text, then check macOS clipboard permissions or another app that may be blocking access. |

The diagnostics drawer reports configuration-oriented guidance. It does not prove that a third-party provider account has remaining quota or network availability.
