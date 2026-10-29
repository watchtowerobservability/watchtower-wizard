import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const readOr = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);

/** Env lines whose names are in `secrets` are masked wherever a change is displayed. */
const mask = (text, names) => text.replace(new RegExp(`^([-+ ]?(?:${names.join("|")})=).*$`, "gm"), "$1***");

/**
 * Pure: turns a plan + secrets into file changes [{path, before, after, skipped?}].
 * `env` is {NAME: value}; written to .env.local, which is added to .gitignore.
 */
export function changes(dir, plan, env) {
  const out = [];
  for (const e of plan.edits) {
    const rel = Array.isArray(e.path) ? (e.path.find((p) => existsSync(join(dir, p))) ?? e.path[0]) : e.path;
    const file = join(dir, rel);
    // Later edits to the same file build on earlier ones (vite: import, then plugin entry).
    const prev = out.findLast((c) => c.path === rel && c.after !== undefined);
    const before = prev ? prev.after : readOr(file);
    if (e.op === "write") {
      out.push(before === null ? { path: rel, before: null, after: e.content } : { path: rel, skipped: "exists, left untouched" });
    } else if (e.op === "append") {
      out.push(before !== null && before.includes(e.content.trim()) ? { path: rel, skipped: "already present" } : { path: rel, before: before ?? "", after: (before ?? "") + (before && !before.endsWith("\n") ? "\n" : "") + e.content });
    } else if (before === null) {
      out.push({ path: rel, skipped: "not found, see notes" });
    } else {
      const m = before.match(e.find);
      const text = m ? before.replace(e.find, e.insert(m[0])) : null;
      out.push(text === null || text === before ? { path: rel, skipped: "no insertion point, see notes" } : { path: rel, before: prev ? prev.before : before, after: text });
      if (prev && text !== null) out.splice(out.indexOf(prev), 1);
    }
  }
  const lines = Object.entries(env).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  const envBefore = readOr(join(dir, ".env.local"));
  const fresh = lines.filter((l) => !new RegExp(`^${l.split("=")[0]}=`, "m").test(envBefore ?? ""));
  if (fresh.length) out.push({ path: ".env.local", before: envBefore, after: (envBefore ?? "") + (envBefore && !envBefore.endsWith("\n") ? "\n" : "") + fresh.join("\n") + "\n", secret: true });
  const gi = readOr(join(dir, ".gitignore"));
  if (fresh.length && !(gi ?? "").split(/\r?\n/).some((l) => l.trim() === ".env.local" || l.trim() === ".env*.local" || l.trim() === ".env*")) {
    out.push({ path: ".gitignore", before: gi, after: (gi ?? "") + (gi && !gi.endsWith("\n") ? "\n" : "") + ".env.local\n" });
  }
  return out;
}

/** Minimal diff: shared head and tail lines are context, the middle is -/+. Never contains secret values. */
export function render(c, secretNames = []) {
  if (c.skipped) return `# ${c.path}: skipped (${c.skipped})\n`;
  const a = (c.before ?? "").split("\n"), b = c.after.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const body = [...a.slice(i, a.length - j).map((l) => `-${l}`), ...b.slice(i, b.length - j).map((l) => `+${l}`)].join("\n");
  return `--- ${c.before === null ? "/dev/null" : "a/" + c.path}\n+++ b/${c.path}\n${mask(body, secretNames)}\n`;
}

export function write(dir, cs) {
  for (const c of cs) {
    if (c.skipped) continue;
    const f = join(dir, c.path);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, c.after, c.secret ? { mode: 0o600 } : undefined);
  }
}

/** `run` is injectable for tests; defaults to spawnSync with inherited stdio and no shell. */
export function install(dir, cmds, run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, stdio: "inherit" })) {
  for (const [cmd, ...args] of cmds) {
    const r = run(cmd, args);
    if (r.status !== 0) return { ok: false, cmd: [cmd, ...args].join(" ") };
  }
  return { ok: true };
}
