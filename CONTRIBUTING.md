# Contributing to VoiceHub

Thanks for contributing. VoiceHub is a macOS desktop tool, so a useful contribution is small, reproducible, and clear about whether it affects the frontend, Rust backend, ASR integration, or LLM refinement.

## Before you start

1. Search existing issues before opening a new one.
2. Do not include API keys, access tokens, private transcripts, or unredacted logs in public discussion.
3. Read [SECURITY.md](SECURITY.md) before reporting a potential vulnerability.
4. Keep a change focused. Do not mix unrelated refactors with a bug fix or feature.

## Local setup

```bash
npm ci
cp .voicehub.dev.example.json .voicehub.dev.json
npm run tauri dev
```

Add credentials only to the ignored local config file or through the app. Do not edit the example file with real values.

## Development workflow

1. Create a branch from `main`, for example `fix/copy-feedback` or `docs/configuration-guide`.
2. Make the smallest change that solves the problem.
3. Add or update focused tests when behavior changes.
4. Run the required checks:

   ```bash
   npm run test:frontend
   npm run build
   ```

5. Open a pull request using the repository template.

## Pull request expectations

- Explain the user-facing behavior before and after the change.
- State the validation performed and any validation that could not be run.
- Keep screenshots and logs free of credentials and private content.
- Update documentation when setup, configuration, or user workflow changes.
- Do not change ASR WebSocket or persisted-secret behavior without a focused reason and validation plan.

## Commit messages

Use short, imperative messages that state the outcome:

```text
Improve configuration diagnostics
Document local ASR setup
Fix prompt copy feedback
```

## Reporting bugs and requesting features

Use the GitHub issue forms. A high-quality report includes the app version or commit, macOS version, exact steps, expected behavior, actual behavior, and redacted diagnostics.
