import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const scriptPath = resolve(import.meta.dir, "sync-policy.mjs");
const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, content: string) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

function git(root: string, ...args: string[]) {
	execFileSync("git", args, { cwd: root, stdio: "pipe" });
}

function createRepo() {
	const root = mkdtempSync(join(tmpdir(), "pi-sync-policy-"));
	tempRoots.push(root);
	git(root, "init", "-b", "main");
	git(root, "config", "user.name", "Test User");
	git(root, "config", "user.email", "test@example.com");
	write(root, "package.json", `${JSON.stringify({ pi: { extensions: ["./extensions/subagents"] } }, null, 2)}\n`);
	write(root, "extensions/subagents/index.ts", "export {};\n");
	write(root, "extensions/subagents/bridge.ts", "export const bridge = 'base';\n");
	write(root, "extensions/subagents/herdr.ts", "export const herdr = 'base';\n");
	write(root, "extensions/subagents/lifecycle.ts", "export const lifecycle = 'base';\n");
	git(root, "add", ".");
	git(root, "commit", "-m", "base");
	return root;
}

test("resolve-conflicts keeps local versions for fork-maintained subagent files", () => {
	const root = createRepo();
	git(root, "checkout", "-b", "upstream");
	git(root, "rm", "extensions/subagents/bridge.ts", "extensions/subagents/herdr.ts");
	write(root, "extensions/subagents/lifecycle.ts", "export const lifecycle = 'upstream';\n");
	git(root, "add", ".");
	git(root, "commit", "-m", "upstream");

	git(root, "checkout", "main");
	write(root, "extensions/subagents/bridge.ts", "export const bridge = 'local';\n");
	write(root, "extensions/subagents/herdr.ts", "export const herdr = 'local';\n");
	write(root, "extensions/subagents/lifecycle.ts", "export const lifecycle = 'local';\n");
	git(root, "add", ".");
	git(root, "commit", "-m", "local");

	const merge = spawnSync("git", ["merge", "--no-edit", "upstream"], { cwd: root, encoding: "utf8" });
	expect(merge.status).not.toBe(0);

	execFileSync("node", [scriptPath, "resolve-conflicts"], { cwd: root, stdio: "pipe" });

	expect(execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: root, encoding: "utf8" }).trim()).toBe("");
	expect(execFileSync("git", ["show", ":extensions/subagents/bridge.ts"], { cwd: root, encoding: "utf8" })).toContain("'local'");
	expect(execFileSync("git", ["show", ":extensions/subagents/herdr.ts"], { cwd: root, encoding: "utf8" })).toContain("'local'");
	expect(execFileSync("git", ["show", ":extensions/subagents/lifecycle.ts"], { cwd: root, encoding: "utf8" })).toContain("'local'");
});

test("resolve-conflicts fails for conflicts outside the allowlist", () => {
	const root = createRepo();
	git(root, "checkout", "-b", "upstream");
	write(root, "extensions/subagents/index.ts", "export const value = 'upstream';\n");
	git(root, "add", "extensions/subagents/index.ts");
	git(root, "commit", "-m", "upstream");

	git(root, "checkout", "main");
	write(root, "extensions/subagents/index.ts", "export const value = 'local';\n");
	git(root, "add", "extensions/subagents/index.ts");
	git(root, "commit", "-m", "local");

	const merge = spawnSync("git", ["merge", "--no-edit", "upstream"], { cwd: root, encoding: "utf8" });
	expect(merge.status).not.toBe(0);

	const result = spawnSync("node", [scriptPath, "resolve-conflicts"], { cwd: root, encoding: "utf8" });
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("unsupported merge conflicts");
	expect(execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: root, encoding: "utf8" }).trim()).toBe("extensions/subagents/index.ts");
});
