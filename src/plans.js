// A plan is plain data:
//   install: [[cmd, ...args]]            commands run in the project dir
//   edits:   [{op, path, ...}]           "write" (create, never overwrite), "append", "patch" ({find, insert(match)})
//   notes:   [string]                    manual follow-ups printed at the end
//   keyKind: "secret" | "publishable" | "none",  keyVar: env var written to .env.local
// `path` may be an array of candidates for "patch"; the first existing one is used.
const PKG = "@watchtowerobservability";
const GO_INIT = `package main

import (
	"context"
	"os"

	wt "github.com/watchtowerobservability/watchtower-go"
)

// initWatchtower returns a shutdown func; call it first in main and defer the result.
func initWatchtower(ctx context.Context) (func(context.Context) error, error) {
	return wt.Init(ctx, wt.Options{APIKey: os.Getenv("WT_INGEST_KEY"), Service: os.Getenv("WT_SERVICE")})
}
`;
const JAVA_NOTE = `Init: Watchtower.init(new Watchtower.Options().apiKey(System.getenv("WT_INGEST_KEY"))).`;

export function pubVar(fw) {
  if (fw === "next") return "NEXT_PUBLIC_WT_PUBLISHABLE_KEY";
  if (fw === "vite" || fw === "@sveltejs/kit") return "VITE_WT_PUBLISHABLE_KEY";
  return "WT_PUBLISHABLE_KEY";
}

const add = (pm, pkg) => [pm, pm === "npm" ? "install" : "add", pkg];

function browser(p) {
  const v = pubVar(p.framework);
  const vite = p.framework === "vite" || p.framework === "@sveltejs/kit";
  const env = (n) => (p.framework === "next" ? `process.env.${n}` : vite ? `import.meta.env.${n}` : `process.env.${n}`);
  const pre = p.framework === "next" ? "NEXT_PUBLIC_" : vite ? "VITE_" : "";
  const edits = [{
    op: "write", path: `src/watchtower.${p.ts ? "ts" : "js"}`,
    content: `import { init } from "${PKG}/browser";\n\nexport const wt = init({\n  publishableKey: ${env(v)},\n  endpoint: ${env(pre + "WT_OTLP_ENDPOINT")},\n  service: "web",\n  environment: "production",\n});\n`,
  }];
  const notes = [`Import "./watchtower" once at your app entry point, before anything else.`];
  if (p.framework === "vite") {
    const files = ["vite.config.ts", "vite.config.js", "vite.config.mjs"];
    edits.push(
      { op: "patch", path: files, find: /^/, insert: () => `import { watchtower } from "${PKG}/browser/vite-plugin";\n` },
      { op: "patch", path: files, find: /plugins:\s*\[/, insert: (m) => `${m}watchtower({ api: process.env.WT_API_URL ?? "", project: process.env.WT_PROJECT_ID ?? "" }), ` },
    );
    notes.push(`Source maps: set build.sourcemap to "hidden"; export WT_API_URL, WT_PROJECT_ID and the secret WT_API_KEY in CI only. Maps upload at build and are deleted afterwards.`);
  } else if (p.framework === "next" || p.framework === "webpack") {
    notes.push(`Source maps: add watchtower({ api, project }) from "${PKG}/browser/webpack-plugin" to your webpack config (in next.config, the webpack hook) and enable browser source maps. Export the secret WT_API_KEY in CI only.`);
  } else {
    notes.push(`Source maps: use "${PKG}/browser/rollup-plugin" or \`wtctl sourcemaps upload\` in your build. Export the secret WT_API_KEY in CI only.`);
  }
  return { install: [add(p.pm, `${PKG}/browser`)], edits, notes, keyKind: "publishable", keyVar: v };
}

const BUILDERS = {
  browser,
  node: (p) => ({
    install: [add(p.pm, `${PKG}/node`)],
    edits: [{ op: "write", path: "watchtower.js", content: `import * as wt from "${PKG}/node";\n\nwt.init({ apiKey: process.env.WT_INGEST_KEY, project: process.env.WT_PROJECT_ID, service: process.env.WT_SERVICE ?? "app", bufferDir: ".wt-buffer" });\n` }],
    notes: [`Run with: node --env-file=.env.local --import ./watchtower.js app.js`],
  }),
  go: () => ({
    install: [["go", "get", "github.com/watchtowerobservability/watchtower-go@latest"]],
    edits: [{ op: "write", path: "watchtower.go", content: GO_INIT }],
    notes: [`Load .env.local before running: set -a; . ./.env.local; set +a`],
  }),
  python: (p) => ({
    install: [["pip", "install", "watchtower-observability"]],
    edits: [
      { op: "write", path: "watchtower_setup.py", content: `import os\nimport watchtower\n\nwatchtower.init(os.environ["WT_INGEST_KEY"], project=os.environ["WT_PROJECT_ID"], buffer_dir=".wt-buffer")\n` },
      ...(p.file === "requirements.txt" ? [{ op: "append", path: "requirements.txt", content: "watchtower-observability\n" }] : []),
    ],
    notes: [`Import watchtower_setup before your app code.`, ...(p.file === "pyproject.toml" ? [`Add "watchtower-observability" to your pyproject.toml dependencies.`] : []), `Load .env.local with python-dotenv or: set -a; . ./.env.local; set +a`],
  }),
  ruby: () => ({
    install: [["bundle", "add", "watchtower-sdk"]],
    edits: [{ op: "write", path: "config/initializers/watchtower.rb", content: `require "watchtower"\n\nWatchtower.init(Watchtower::Config.from_env(service: ENV.fetch("WT_SERVICE", "app")))\n` }],
    notes: [`Rails does not read .env.local itself; use dotenv-rails or export the variables.`],
  }),
  php: () => ({
    install: [["composer", "require", "watchtowerobservability/sdk"]],
    edits: [{ op: "write", path: "watchtower.php", content: `<?php\n// require_once this from your front controller before handling requests.\nrequire_once __DIR__ . '/vendor/autoload.php';\n\n$GLOBALS['wt_tracer_provider'] = Watchtower\\Watchtower::init(Watchtower\\Config::fromEnv(getenv('WT_SERVICE') ?: 'app'));\n` }],
    notes: [],
  }),
  maven: () => ({
    install: [],
    edits: [{ op: "patch", path: "pom.xml", find: /<dependencies>/, insert: (m) => `${m}\n    <dependency>\n      <groupId>io.github.watchtowerobservability</groupId>\n      <artifactId>watchtower-sdk</artifactId>\n      <version>0.1.0</version>\n    </dependency>` }],
    notes: [JAVA_NOTE, `Add the GitHub Packages Maven repository to settings.xml. Mapping upload: the Watchtower Maven plugin (sdks/maven-plugin).`],
  }),
  gradle: (p) => ({
    install: [],
    edits: [{ op: "patch", path: p.file, find: /dependencies\s*\{/, insert: (m) => `${m}\n    implementation("io.github.watchtowerobservability:watchtower-sdk:0.1.0")` }],
    notes: [JAVA_NOTE, `ProGuard/R8 mapping upload: add the Watchtower Gradle plugin (sdks/gradle-plugin) to plugins {}.`],
  }),
  dotnet: () => ({
    install: [["dotnet", "add", "package", "Watchtower.Sdk"]],
    edits: [],
    notes: [`Add at startup: using var tp = Watchtower.Init(Config.FromEnv("app"), "MyApp");`, `Add the GitHub Packages NuGet source first (see the SDK README).`],
  }),
  dart: () => ({
    install: [],
    edits: [],
    notes: [`The Dart/Flutter SDK is not published yet; once it is: dart pub add watchtower. Nothing changed.`],
    keyKind: "none",
  }),
  ios: () => ({
    install: [],
    edits: [],
    notes: [`Add https://github.com/watchtowerobservability/watchtower-ios with Swift Package Manager (CocoaPods is not published).`, `Start: Watchtower.start(Config(key: "<publishable-key>", service: "ios-app")). Use a publishable key in apps.`],
    keyKind: "publishable", keyVar: "WT_PUBLISHABLE_KEY",
  }),
};

export function plan(p) {
  const b = BUILDERS[p.kind](p);
  return { keyKind: "secret", keyVar: "WT_INGEST_KEY", ...b };
}
