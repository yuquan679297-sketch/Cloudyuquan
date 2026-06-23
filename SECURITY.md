# Security Policy

## Supported versions

Security fixes are applied to the latest code on the `main` branch. There are no packaged release channels yet.

## Reporting a vulnerability

Do not disclose API keys, tokens, private transcripts, or exploit details in a public issue.

Use GitHub's private security advisory flow for this repository:

<https://github.com/yuquan679297-sketch/Cloudyuquan/security/advisories/new>

If private reporting is unavailable, open a minimal public issue that requests a private contact channel. Do not include the vulnerability details in that issue.

## Scope

Relevant reports include issues involving local credential handling, unintended disclosure through logs or configuration, unsafe clipboard behavior, and dependency vulnerabilities that affect this project.

Configuration errors involving a user's own ASR or LLM account are generally support issues rather than security vulnerabilities. Redact all credentials before reporting either type of problem.
