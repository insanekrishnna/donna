import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Secret scan (PHASES.md B6). Run: npm run scan:secrets
 *
 * 1. Every secret value in the local .env is searched for, in its raw and un-prefixed (no 0x)
 *    forms, in all tracked files and in the full Git history of every branch.
 * 2. Known secret shapes (provider keys, PEM blocks, mnemonic lines) are searched for in history.
 *
 * Output names variables and commits only. It never prints a secret value. Exit code 1 on any find.
 */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const SECRET_NAMES = [
  "LLM_API_KEY",
  "HEDERA_MERCHANT_PRIVATE_KEY",
  "HEDERA_AGENT_PRIVATE_KEY",
  "ARKIV_ACCESS_KEY",
  "ARKIV_SERVER_PRIVATE_KEY",
  // Restricted to the app's origins, so less sensitive, but still never committed.
  "VITE_ARKIV_ACCESS_KEY",
];

const git = (args: string[]) =>
  execFileSync("git", args, { cwd: repoRoot, maxBuffer: 1024 * 1024 * 512, encoding: "utf8" });

let env: Record<string, string> = {};
try {
  env = dotenv.parse(readFileSync(new URL("../../.env", import.meta.url)));
} catch {
  console.log("No .env found: skipping the value check, running the pattern check only.");
}

const history = git(["log", "-p", "--all", "--no-color"]);
const tracked = git(["grep", "-I", "-n", "--no-color", "-e", "."]);
let findings = 0;

// 1. Exact values from .env.
for (const name of SECRET_NAMES) {
  const value = env[name]?.trim();
  if (!value) continue;
  const forms = new Set([value, value.replace(/^0x/, "")].filter((f) => f.length >= 12));
  for (const form of forms) {
    if (tracked.includes(form)) {
      console.log(`FOUND: the value of ${name} is in a tracked file.`);
      findings += 1;
    }
    if (history.includes(form)) {
      console.log(`FOUND: the value of ${name} is in Git history.`);
      findings += 1;
    }
  }
}

// 2. Known secret shapes in history. The test placeholders are excluded by name.
const PATTERNS: [string, RegExp][] = [
  ["OpenRouter/OpenAI-style key", /\bsk-(?:or-v1-)?[A-Za-z0-9]{32,}\b/g],
  ["Arkiv access key", /\bark_live_[A-Za-z0-9_-]{16,}\b/g],
  ["PEM private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["seed phrase assignment", /\b(?:mnemonic|seed[_ ]?phrase)\s*[:=]\s*["']?[a-z]+(?: [a-z]+){11,23}/gi],
];
for (const [label, pattern] of PATTERNS) {
  const matches = history.match(pattern) ?? [];
  if (matches.length > 0) {
    console.log(`FOUND: ${matches.length} match(es) for "${label}" in Git history.`);
    findings += matches.length;
  }
}

// 3. .env itself must never be tracked or committed.
const everCommitted = git(["log", "--all", "--format=%h", "--", ".env"]).trim();
if (everCommitted) {
  console.log(`FOUND: .env was committed in: ${everCommitted.split("\n").join(", ")}`);
  findings += 1;
}

if (findings === 0) {
  const commits = git(["rev-list", "--all", "--count"]).trim();
  console.log(`No secrets found. Checked ${SECRET_NAMES.length} .env values and ${PATTERNS.length} patterns across ${commits} commits.`);
} else {
  console.log(`${findings} finding(s). Rotate any exposed key, then remove it from history.`);
  process.exit(1);
}
