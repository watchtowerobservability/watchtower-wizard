# @watchtowerobservability/wizard

[![CI](https://github.com/watchtowerobservability/watchtower-wizard/actions/workflows/ci.yml/badge.svg)](https://github.com/watchtowerobservability/watchtower-wizard/actions/workflows/ci.yml)

One command that detects your project, installs the Watchtower SDK, writes the init snippet, wires
source-map upload where it can, and sends a test event. Plain JavaScript, no runtime dependencies.

## Install and quick start

```sh
npx @watchtowerobservability/wizard            # run in your project directory
npx @watchtowerobservability/wizard --dry-run  # print the diff, change nothing
npx @watchtowerobservability/wizard verify     # send a test span
```

The key is typed at a hidden prompt (or read from `WT_INGEST_KEY` / `WT_PUBLISHABLE_KEY` in the
environment). It is never a command-line flag, and it is written only to `.env.local`, which the
wizard adds to `.gitignore`. Client apps need a publishable key (`wtp_...`); servers a secret ingest key.

## Integrations

| Detected by | Installs | Writes |
|---|---|---|
| `package.json` with next, vite, react, vue, angular, sveltekit, webpack | `@watchtowerobservability/browser` | `src/watchtower.(ts\|js)`; Vite config patched with the source-map plugin; other bundlers get a printed step |
| `package.json` with express, fastify, koa, nestjs | `@watchtowerobservability/node` | `watchtower.js` |
| `go.mod` | `watchtower-go` | `watchtower.go` |
| `pyproject.toml` / `requirements.txt` | `watchtower-sdk` | `watchtower_setup.py` (and `requirements.txt`) |
| `Gemfile` | `watchtower-sdk` gem | `config/initializers/watchtower.rb` |
| `composer.json` | `watchtowerobservability/sdk` | `watchtower.php` |
| `pom.xml`, `build.gradle(.kts)` | Java SDK dependency inserted | printed init and mapping-upload steps |
| `*.csproj` | `Watchtower.Sdk` | printed init step |
| `pubspec.yaml`, `Podfile` | nothing yet | printed instructions (Dart SDK unpublished; iOS uses Swift Package Manager) |

Existing files are never overwritten; steps that cannot be applied safely are printed as notes.

## Configuration

| Name | Meaning |
|---|---|
| `WT_INGEST_KEY` | secret ingest key (server SDKs) |
| `WT_PUBLISHABLE_KEY` | publishable key (client SDKs); `VITE_` / `NEXT_PUBLIC_` prefixed for those bundlers |
| `WT_OTLP_ENDPOINT` | default `http://localhost:4318`; used by `verify` |
| `WT_SERVICE`, `WT_ENVIRONMENT`, `WT_RELEASE` | passed through to the SDK |
| `WT_API_KEY` | secret API key for source-map upload, kept out of client bundles |

## Provenance

Every release artifact carries a GitHub build attestation. Verify one with
`gh attestation verify <file> --repo watchtowerobservability/watchtower-wizard`.

## License

Apache-2.0. Source of truth is the Watchtower monorepo; this repository is a published mirror.
