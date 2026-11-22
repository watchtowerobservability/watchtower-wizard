# Changelog

## 0.1.1

- Sync with the monorepo: Hermetica write-up follow-ups.

## 0.1.0

- Project detection: Node (express, fastify, koa, nestjs), browser (next, vite, react, vue, angular, sveltekit, webpack), Go, Python, Ruby, PHP, Maven, Gradle, .NET, Dart/Flutter, iOS.
- Interactive hidden key prompt; key written only to `.env.local`, which is added to `.gitignore`.
- Installs the SDK, writes the init snippet, wires the Vite source-map plugin, prints manual steps elsewhere.
- `--dry-run` prints a diff with secrets masked; `verify` sends a test span.
