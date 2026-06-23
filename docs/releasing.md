# Release Guide

This guide is for maintainers preparing a public source release. It does not yet describe distributing a signed macOS installer, because reproducible bundling, code signing, and notarization are not configured in this repository.

## Source release checklist

1. Confirm the working tree contains only intended changes.
2. Verify that no local keys, transcripts, or generated artifacts are staged.
3. Update `CHANGELOG.md` and keep the version in `package.json` and `src-tauri/Cargo.toml` aligned.
4. Run:

   ```bash
   npm run test:frontend
   npm run build
   ```

5. Review the GitHub Actions result after pushing.
6. Create an annotated Git tag such as `v0.1.1` only after the matching commit is on `main`.
7. Create a GitHub Release with concise notes covering user-visible changes, configuration impact, and known limitations.

## Before binary distribution

Do not publish a downloadable desktop binary until all of the following are verified:

- Tauri bundle output is enabled and reproducible on a clean macOS machine.
- The app is code signed with a maintainer-controlled certificate.
- macOS notarization is configured and tested.
- The build process does not embed credentials or local development config.
- Installation, microphone permission, ASR setup, LLM setup, and uninstall behavior are documented.

Until then, GitHub source releases are the supported distribution format.
