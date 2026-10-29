import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (dir, f) => {
  try { return readFileSync(join(dir, f), "utf8"); } catch { return null; }
};
const has = (dir, f) => existsSync(join(dir, f));
const ext = (dir, e) => { try { return readdirSync(dir).some((f) => f.endsWith(e)); } catch { return false; } };

// Browser frameworks win over server ones (a Next app is browser + server; we wire the browser SDK).
const JS_BROWSER = ["next", "vite", "react-scripts", "@angular/core", "@sveltejs/kit", "vue", "react"];
const JS_SERVER = ["@nestjs/core", "fastify", "express", "koa"];

function pm(dir) {
  if (has(dir, "pnpm-lock.yaml")) return "pnpm";
  if (has(dir, "yarn.lock")) return "yarn";
  return "npm";
}

/** Returns {kind, framework, ...} for the project in `dir`, or null when nothing is recognised. */
export function detect(dir) {
  const pkg = read(dir, "package.json");
  if (pkg) {
    let j = {};
    try { j = JSON.parse(pkg); } catch { /* unparsable package.json: treat as no deps */ }
    const deps = { ...j.dependencies, ...j.devDependencies };
    const ts = has(dir, "tsconfig.json");
    const b = JS_BROWSER.find((d) => d in deps);
    if (b) return { kind: "browser", framework: b === "react-scripts" ? "webpack" : b, ts, pm: pm(dir) };
    if ("webpack" in deps) return { kind: "browser", framework: "webpack", ts, pm: pm(dir) };
    return { kind: "node", framework: JS_SERVER.find((d) => d in deps) ?? "node", pm: pm(dir) };
  }
  if (has(dir, "go.mod")) return { kind: "go", framework: "go" };
  const pyproject = read(dir, "pyproject.toml");
  const reqs = read(dir, "requirements.txt");
  if (pyproject !== null || reqs !== null || has(dir, "setup.py")) {
    const txt = ((pyproject ?? "") + "\n" + (reqs ?? "")).toLowerCase();
    const fw = ["django", "fastapi", "flask", "celery"].find((f) => new RegExp(`(^|[\\s"'])${f}\\b`, "m").test(txt));
    return { kind: "python", framework: fw ?? "python", file: pyproject !== null ? "pyproject.toml" : "requirements.txt" };
  }
  const gem = read(dir, "Gemfile");
  if (gem !== null) return { kind: "ruby", framework: /\brails\b/.test(gem) ? "rails" : "ruby" };
  const comp = read(dir, "composer.json");
  if (comp !== null) return { kind: "php", framework: /laravel\/framework/.test(comp) ? "laravel" : /symfony\//.test(comp) ? "symfony" : "php" };
  const pom = read(dir, "pom.xml");
  if (pom !== null) return { kind: "maven", framework: /spring-boot/.test(pom) ? "spring-boot" : "java" };
  for (const g of ["build.gradle.kts", "build.gradle"]) {
    const t = read(dir, g);
    if (t !== null) return { kind: "gradle", framework: /com\.android/.test(t) ? "android" : "java", file: g };
  }
  if (ext(dir, ".csproj")) return { kind: "dotnet", framework: "dotnet" };
  const pub = read(dir, "pubspec.yaml");
  if (pub !== null) return { kind: "dart", framework: /sdk:\s*flutter/.test(pub) ? "flutter" : "dart" };
  if (has(dir, "Podfile")) return { kind: "ios", framework: "cocoapods" };
  return null;
}
