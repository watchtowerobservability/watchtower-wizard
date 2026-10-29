import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detect } from "../src/detect.js";
import { plan } from "../src/plans.js";
import { changes, render } from "../src/apply.js";
import { main } from "../src/cli.js";
import { sendTestEvent } from "../src/verify.js";

const SECRET = "wti_supersecretvalue123";
const PUB = "wtp_publishable456";

/** Builds a fixture project in a temp dir from {relPath: content}. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "wt-wizard-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}
const pkg = (deps) => JSON.stringify({ name: "x", dependencies: deps });

const DETECT = [
  ["next", { "package.json": pkg({ next: "14", react: "18" }) }, "browser", "next"],
  ["vite", { "package.json": pkg({ vite: "5" }), "pnpm-lock.yaml": "" }, "browser", "vite"],
  ["express", { "package.json": pkg({ express: "4" }) }, "node", "express"],
  ["nestjs", { "package.json": pkg({ "@nestjs/core": "10" }) }, "node", "@nestjs/core"],
  ["go", { "go.mod": "module x\n" }, "go", "go"],
  ["django", { "requirements.txt": "Django==5\n" }, "python", "django"],
  ["fastapi", { "pyproject.toml": 'dependencies = ["fastapi>=0.1"]\n' }, "python", "fastapi"],
  ["rails", { Gemfile: "gem 'rails'\n" }, "ruby", "rails"],
  ["laravel", { "composer.json": '{"require":{"laravel/framework":"^11"}}' }, "php", "laravel"],
  ["spring", { "pom.xml": "<project><dependencies><dependency>spring-boot</dependency></dependencies></project>" }, "maven", "spring-boot"],
  ["android", { "build.gradle.kts": 'plugins { id("com.android.application") }\ndependencies {\n}\n' }, "gradle", "android"],
  ["dotnet", { "App.csproj": "<Project/>" }, "dotnet", "dotnet"],
  ["flutter", { "pubspec.yaml": "dependencies:\n  flutter:\n    sdk: flutter\n" }, "dart", "flutter"],
  ["ios", { Podfile: "target 'A' do\nend\n" }, "ios", "cocoapods"],
];
for (const [name, files, kind, fw] of DETECT) {
  test(`detect ${name}`, () => {
    const d = detect(fixture(files));
    assert.equal(d.kind, kind);
    assert.equal(d.framework, fw);
  });
}
test("detect nothing", () => assert.equal(detect(fixture({ "README.md": "x" })), null));

test("every detected kind has a plan", () => {
  for (const [, files] of DETECT) {
    const p = plan(detect(fixture(files)));
    assert.ok(Array.isArray(p.install) && Array.isArray(p.edits));
  }
});

const quiet = () => {
  const lines = [];
  return { lines, out: (s) => lines.push(s) };
};

test("express: writes init, key only in .env.local, gitignored, installs", async () => {
  const dir = fixture({ "package.json": pkg({ express: "4" }), ".gitignore": "node_modules" });
  const q = quiet();
  const ran = [];
  const code = await main([dir], { env: {}, ask: async () => SECRET, out: q.out, run: (c, a) => (ran.push([c, ...a]), { status: 0 }) });
  assert.equal(code, 0);
  assert.deepEqual(ran, [["npm", "install", "@watchtowerobservability/node"]]);
  assert.match(readFileSync(join(dir, "watchtower.js"), "utf8"), /process\.env\.WT_INGEST_KEY/);
  assert.equal(readFileSync(join(dir, "watchtower.js"), "utf8").includes(SECRET), false);
  assert.equal(readFileSync(join(dir, ".env.local"), "utf8"), `WT_INGEST_KEY=${SECRET}\n`);
  assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /^\.env\.local$/m);
  assert.equal(statSync(join(dir, ".env.local")).mode & 0o077, 0);
  assert.equal(q.lines.join("\n").includes(SECRET), false);
  assert.match(q.lines.join("\n"), /wizard verify/);
});

test("dry run writes nothing, runs nothing, never prints the key", async () => {
  const dir = fixture({ "package.json": pkg({ express: "4" }) });
  const q = quiet();
  const code = await main([dir, "--dry-run"], { env: {}, ask: async () => SECRET, out: q.out, run: () => assert.fail("must not install") });
  assert.equal(code, 0);
  assert.equal(existsSync(join(dir, "watchtower.js")), false);
  assert.equal(existsSync(join(dir, ".env.local")), false);
  const text = q.lines.join("\n");
  assert.match(text, /\+\+\+ b\/watchtower\.js/);
  assert.match(text, /\+WT_INGEST_KEY=\*\*\*/);
  assert.equal(text.includes(SECRET), false);
});

test("vite: patches config (import then plugin), publishable key", async () => {
  const dir = fixture({
    "package.json": pkg({ vite: "5" }), "tsconfig.json": "{}",
    "vite.config.ts": 'import { defineConfig } from "vite";\nexport default defineConfig({ plugins: [react()] });\n',
  });
  const code = await main([dir, "--no-install"], { env: {}, ask: async (q) => (/source-map/.test(q) ? "" : PUB), out: () => {} });
  assert.equal(code, 0);
  const cfg = readFileSync(join(dir, "vite.config.ts"), "utf8");
  assert.match(cfg, /^import \{ watchtower \} from "@watchtowerobservability\/browser\/vite-plugin";/);
  assert.match(cfg, /plugins: \[watchtower\(\{/);
  assert.match(readFileSync(join(dir, "src/watchtower.ts"), "utf8"), /import\.meta\.env\.VITE_WT_PUBLISHABLE_KEY/);
  assert.match(readFileSync(join(dir, ".env.local"), "utf8"), /^VITE_WT_PUBLISHABLE_KEY=wtp_/);
});

test("client apps refuse a secret key, server apps refuse a publishable one", async () => {
  const web = fixture({ "package.json": pkg({ vite: "5" }) });
  assert.equal(await main([web], { env: {}, ask: async () => SECRET, out: () => {} }), 1);
  assert.equal(existsSync(join(web, ".env.local")), false);
  const srv = fixture({ "go.mod": "module x\n" });
  assert.equal(await main([srv], { env: {}, ask: async () => PUB, out: () => {} }), 1);
});

test("keys are rejected as arguments", async () => {
  const q = quiet();
  assert.equal(await main(["--key=abc"], { out: q.out }), 2);
  assert.equal(await main([SECRET], { out: q.out }), 2);
});

test("existing files are never overwritten; env key is not duplicated", async () => {
  const dir = fixture({ "go.mod": "module x\n", "watchtower.go": "mine", ".env.local": "WT_INGEST_KEY=old\n", ".gitignore": ".env*\n" });
  const q = quiet();
  assert.equal(await main([dir, "--no-install"], { env: {}, ask: async () => SECRET, out: q.out }), 0);
  assert.equal(readFileSync(join(dir, "watchtower.go"), "utf8"), "mine");
  assert.equal(readFileSync(join(dir, ".env.local"), "utf8"), "WT_INGEST_KEY=old\n");
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), ".env*\n");
});

test("requirements.txt gets the dependency appended once", () => {
  const dir = fixture({ "requirements.txt": "flask\n" });
  const p = plan(detect(dir));
  const cs = changes(dir, p, {});
  const req = cs.find((c) => c.path === "requirements.txt");
  assert.equal(req.after, "flask\nwatchtower-sdk\n");
  assert.match(render(req), /\+watchtower-sdk/);
});

test("gradle and maven dependencies are inserted", () => {
  const g = fixture({ "build.gradle.kts": "dependencies {\n}\n" });
  assert.match(changes(g, plan(detect(g)), {})[0].after, /watchtower-sdk:0\.1\.0/);
  const m = fixture({ "pom.xml": "<project><dependencies></dependencies></project>" });
  assert.match(changes(m, plan(detect(m)), {})[0].after, /<artifactId>watchtower-sdk/);
});

test("verify sends one OTLP span with the bearer header", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => (calls.push([url, init]), { ok: true, status: 200 });
  const r = await sendTestEvent({ endpoint: "http://x:4318/", key: SECRET, fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(calls[0][0], "http://x:4318/v1/traces");
  assert.equal(calls[0][1].headers.authorization, `Bearer ${SECRET}`);
  assert.equal(JSON.parse(calls[0][1].body).resourceSpans[0].scopeSpans[0].spans[0].name, "wizard.verify");
});

test("verify subcommand reads .env.local and masks the key in errors", async () => {
  const dir = fixture({ ".env.local": `WT_INGEST_KEY=${SECRET}\n` });
  const q = quiet();
  const code = await main(["verify", dir], { env: {}, out: q.out, fetchImpl: async () => { throw new Error(`boom ${SECRET}`); } });
  assert.equal(code, 1);
  assert.equal(q.lines.join("\n").includes(SECRET), false);
});
