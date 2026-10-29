import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { detect } from "./detect.js";
import { plan } from "./plans.js";
import { changes, install, render, write } from "./apply.js";
import { DEFAULT_ENDPOINT, sendTestEvent } from "./verify.js";

const USAGE = `usage: wizard [dir] [--dry-run] [--no-install] [--yes]
       wizard verify [dir]

The key is asked for interactively (input hidden) or read from the environment
(WT_INGEST_KEY, or WT_PUBLISHABLE_KEY for client apps). It is never a flag and is
written only to .env.local, which is added to .gitignore.
`;

/** Prompt without echoing. Falls back to a plain line read when stdin is not a TTY. */
export function askHidden(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((res) => {
    output.write(question);
    if (!input.isTTY) {
      const rl = createInterface({ input });
      rl.once("line", (l) => { rl.close(); res(l.trim()); });
      return;
    }
    let buf = "";
    input.setRawMode(true);
    input.resume();
    const onData = (ch) => {
      for (const c of String(ch)) {
        if (c === "\r" || c === "\n") { input.setRawMode(false); input.pause(); input.off("data", onData); output.write("\n"); return res(buf.trim()); }
        if (c === "\u0003") process.exit(130);
        buf = c === "\u007f" ? buf.slice(0, -1) : buf + c;
      }
    };
    input.on("data", onData);
  });
}

function loadEnvLocal(dir) {
  try {
    return Object.fromEntries(readFileSync(join(dir, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  } catch { return {}; }
}

export async function main(argv, { env = process.env, ask = askHidden, out = (s) => process.stdout.write(s + "\n"), fetchImpl = fetch, run } = {}) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const flag = (f) => argv.includes(f);
  if (flag("--help") || flag("-h")) { out(USAGE); return 0; }
  // A key on the command line would land in shell history and `ps`.
  if (argv.some((a) => /^--(key|api-?key|token|secret)/i.test(a) || /^wt[a-z]*_/i.test(a))) {
    out("error: keys are never accepted as arguments; the wizard asks for it interactively.");
    return 2;
  }

  if (args[0] === "verify") {
    const dir = resolve(args[1] ?? ".");
    const e = { ...loadEnvLocal(dir), ...env };
    const key = e.WT_INGEST_KEY || e.WT_PUBLISHABLE_KEY || e.VITE_WT_PUBLISHABLE_KEY || e.NEXT_PUBLIC_WT_PUBLISHABLE_KEY;
    if (!key) { out("error: no key found in the environment or .env.local; run the wizard first."); return 1; }
    const r = await sendTestEvent({ endpoint: e.WT_OTLP_ENDPOINT || DEFAULT_ENDPOINT, key, service: e.WT_SERVICE || "wizard-verify", fetchImpl });
    out(r.ok ? "Test event accepted. Open Traces and look for the span 'wizard.verify'." : `Test event failed (status ${r.status}${r.error ? ", " + r.error : ""}). Check the key and WT_OTLP_ENDPOINT.`);
    return r.ok ? 0 : 1;
  }

  const dir = resolve(args[0] ?? ".");
  const found = detect(dir);
  if (!found) { out("No supported project found (package.json, go.mod, pyproject/requirements, Gemfile, composer.json, pom/gradle, csproj, pubspec, Podfile)."); return 1; }
  const p = plan(found);
  out(`Detected ${found.framework} (${found.kind}).`);

  const secrets = {};
  if (p.keyKind !== "none") {
    const label = p.keyKind === "publishable" ? "publishable key (wtp_...)" : "secret ingest key";
    const key = env[p.keyVar] || (await ask(`Watchtower ${label}: `));
    if (!key) { out("error: a key is required."); return 1; }
    if (p.keyKind === "publishable" && !key.startsWith("wtp_")) { out("error: client apps need a publishable key (wtp_...), never a secret key."); return 1; }
    if (p.keyKind === "secret" && key.startsWith("wtp_")) { out("error: this is a server project; use a secret ingest key, not a publishable one."); return 1; }
    secrets[p.keyVar] = key;
    if (found.kind === "browser" && !flag("--dry-run")) {
      const up = env.WT_API_KEY || (await ask("Secret API key for source-map upload (Enter to skip): "));
      if (up) secrets.WT_API_KEY = up;
    }
  }

  const cs = changes(dir, p, secrets);
  const names = Object.keys(secrets);
  if (flag("--dry-run")) {
    out("Dry run, nothing written or installed.");
    for (const c of p.install) out(`$ ${c.join(" ")}`);
    for (const c of cs) out(render(c, names));
    for (const n of p.notes) out(`note: ${n}`);
    return 0;
  }
  write(dir, cs);
  for (const c of cs) out(c.skipped ? `skipped ${c.path} (${c.skipped})` : `wrote ${c.path}`);
  if (!flag("--no-install")) {
    const r = install(dir, p.install, run);
    if (!r.ok) { out(`Install failed: ${r.cmd}. Run it yourself, then re-run the wizard.`); return 1; }
  }
  for (const n of p.notes) out(`note: ${n}`);
  out(`\nVerify: npx @watchtowerobservability/wizard verify${args[0] ? " " + args[0] : ""}\nThis sends one test span 'wizard.verify' to WT_OTLP_ENDPOINT (default ${DEFAULT_ENDPOINT}).`);
  return 0;
}
