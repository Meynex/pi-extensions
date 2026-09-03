#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "check";
const allowedModes = new Set(["apply", "check", "report"]);
if (!allowedModes.has(mode)) {
  console.error(`Usage: node scripts/sync-policy.mjs apply|check|report`);
  process.exit(2);
}

const extensionNames = readdirSync("extensions", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => entry.name !== "web-search")
  .filter((entry) => readdirSync(`extensions/${entry.name}`).includes("index.ts") || readdirSync(`extensions/${entry.name}`).includes("index.js"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));
const expectedExtensions = extensionNames.map((name) => `./extensions/${name}`);

function readPackage() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}

function writePackage(pkg) {
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

function applyPolicy() {
  const pkg = readPackage();
  pkg.pi = { ...(pkg.pi ?? {}), extensions: expectedExtensions };
  writePackage(pkg);
}

function diffNameOnly(baseRef) {
  return execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function diffText(baseRef) {
  return execFileSync("git", ["diff", "--no-ext-diff", "--unified=0", `${baseRef}...HEAD`], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function commitLog(baseRef) {
  return execFileSync("git", ["log", "--oneline", "--no-merges", `${baseRef}..HEAD`], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  }).trim();
}

function diffStat(baseRef) {
  return execFileSync("git", ["diff", "--stat", `${baseRef}...HEAD`], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  }).trim();
}

function validatePolicy() {
  const pkg = readPackage();
  const actual = pkg.pi?.extensions;
  const errors = [];
  if (!Array.isArray(actual)) {
    errors.push("package.json pi.extensions must be an array");
  } else {
    if (actual.includes("./extensions/*")) errors.push("package.json must not load ./extensions/*");
    if (actual.includes("./extensions/web-search")) errors.push("package.json must not load ./extensions/web-search");
    const missing = expectedExtensions.filter((item) => !actual.includes(item));
    const extra = actual.filter((item) => !expectedExtensions.includes(item));
    if (missing.length) errors.push(`missing explicit extensions: ${missing.join(", ")}`);
    if (extra.length) errors.push(`unexpected explicit extensions: ${extra.join(", ")}`);
  }
  return errors;
}

function scanDiff(baseRef) {
  const diff = diffText(baseRef);
  const findings = [];
  const patterns = [
    ["possible_secret", /(?:api[_-]?key|token|secret|password|private[_-]?key)\s*[:=]\s*(?!process\.env\b|\$\{\{\s*secrets\.|\$\{\{\s*github\.token\b)(?:['\"])?[A-Za-z0-9_./+=-]{16,}/i],
    ["tool_registration", /pi\.registerTool\s*\(/],
    ["provider_registration", /pi\.registerProvider\s*\(/],
    ["tool_call_interceptor", /pi\.on\(['\"]tool_call['\"]/],
    ["provider_payload_hook", /pi\.on\(['\"]before_provider_request['\"]/],
    ["shell_execution", /\b(exec|execFile|execFileSync|spawn|spawnSync|execSync|pi\.exec)\s*\(/],
    ["network_access", /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/],
    ["filesystem_access", /\b(readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|mkdir|mkdirSync)\s*\(/],
    ["prompt_or_system_change", /(systemPrompt|promptGuidelines|promptSnippet|before_agent_start)/],
  ];
  for (const [name, pattern] of patterns) {
    if (pattern.test(diff)) findings.push(name);
  }

  const pkg = readPackage();
  const packageRisks = [];
  if (pkg.scripts && Object.keys(pkg.scripts).length) packageRisks.push(`scripts: ${Object.keys(pkg.scripts).join(", ")}`);
  for (const depField of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (pkg[depField]) packageRisks.push(`${depField}: ${Object.keys(pkg[depField]).join(", ")}`);
  }

  return { findings, packageRisks };
}

function parseChangeHints(log) {
  const lines = log.split("\n").filter(Boolean);
  const bugfixes = lines.filter((line) => /\b(fix|bug|repair|regression|crash|error)\b/i.test(line));
  const improvements = lines.filter((line) => /\b(feat|add|improve|enhance|support|update|refactor)\b/i.test(line));
  return { bugfixes, improvements };
}

if (mode === "apply") {
  applyPolicy();
}

const policyErrors = validatePolicy();
if (mode === "check") {
  if (policyErrors.length) {
    console.error(policyErrors.join("\n"));
    process.exit(1);
  }
  console.log(`sync-policy: PASS (${expectedExtensions.length} extensions, web-search excluded)`);
}

if (mode === "report") {
  const baseRef = process.env.SYNC_BASE_REF ?? "origin/main";
  const upstreamOld = process.env.UPSTREAM_OLD ?? "unknown";
  const upstreamNew = process.env.UPSTREAM_NEW ?? "unknown";
  const files = diffNameOnly(baseRef);
  const stat = diffStat(baseRef);
  const log = commitLog(baseRef);
  const { bugfixes, improvements } = parseChangeHints(log);
  const scan = scanDiff(baseRef);
  const body = `## Upstream-Sync\n\nQuelle:\n- Repository: angristan/pi-extensions\n- Basis: \`${upstreamOld}\`\n- Ziel: \`${upstreamNew}\`\n\n## Upstream Commits\n\n${log ? `\`\`\`text\n${log}\n\`\`\`` : "Keine Commitmeldungen gefunden."}\n\n## Diffstat\n\n${stat ? `\`\`\`text\n${stat}\n\`\`\`` : "Keine Diffstat verfügbar."}\n\n## Bugfixes aus Commitmeldungen\n\n${bugfixes.length ? bugfixes.map((line) => `- ${line}`).join("\n") : "- Keine eindeutigen Bugfix-Commitmeldungen erkannt."}\n\n## Verbesserungen aus Commitmeldungen\n\n${improvements.length ? improvements.map((line) => `- ${line}`).join("\n") : "- Keine eindeutigen Verbesserungs-Commitmeldungen erkannt."}\n\n## Geänderte Dateien\n\n${files.length ? files.map((file) => `- \`${file}\``).join("\n") : "- Keine Dateien geändert."}\n\n## Sicherheits- und Kompatibilitätsbefunde\n\nAutomatische Diff-Marker:\n${scan.findings.length ? scan.findings.map((item) => `- ⚠ ${item}`).join("\n") : "- Keine Marker gefunden."}\n\nPackage-Marker:\n${scan.packageRisks.length ? scan.packageRisks.map((item) => `- ${item}`).join("\n") : "- Keine package.json Marker gefunden."}\n\n## Mögliche Bedenken\n\n- Neue Netzwerkzugriffe prüfen.\n- Neue Shell-/Dateisystemzugriffe prüfen.\n- Neue Dependencies und package scripts prüfen.\n- Prompt-, Systemprompt- und Berechtigungsänderungen prüfen.\n- Toolnamen-Konflikte prüfen, insbesondere \`web_search\`.\n- Session-, Memory- und Auto-Commit-Verhalten prüfen.\n\n## Bewusst nicht übernommen\n\n- \`./extensions/web-search\` bleibt deaktiviert, damit \`npm:pi-web-access\` die einzige \`web_search\`-Quelle bleibt.\n- Produktive Pi-Konfigurationen und Secrets werden nicht geändert.\n\n## Tests\n\n- [ ] \`node scripts/sync-policy.mjs check\`\n- [ ] \`bun test documentation.test.ts\`\n- [ ] \`git diff --check\`\n- [ ] Secret-Scan\n- [ ] Copilot Security/Prompt-Injection Review\n- [ ] Copilot Extensions/Dependencies Review\n- [ ] Copilot Regression Review\n\n## Review-Ergebnis\n\nSecurity/Prompt-Injection: BLOCK bis Copilot-Review PASS meldet.\nExtensions/Dependencies: BLOCK bis Copilot-Review PASS meldet.\nRegression/Kompatibilität: BLOCK bis Copilot-Review PASS meldet.\nGesamt: BLOCK bis alle Checks bestanden sind und ein Mensch manuell merged.\n`;
  writeFileSync(process.env.PR_BODY_FILE ?? "upstream-sync-pr-body.md", body);
  console.log(body);
}
