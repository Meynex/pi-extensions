import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const repositoryRoot = import.meta.dir;
const extensionsRoot = join(repositoryRoot, "extensions");
const rootReadmePath = join(repositoryRoot, "README.md");

function extensionDirectories(): string[] {
	return readdirSync(extensionsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function walk(directory: string, predicate: (path: string) => boolean): string[] {
	const paths: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) paths.push(...walk(path, predicate));
		else if (predicate(path)) paths.push(path);
	}
	return paths;
}

function directExtensionImports(): string[] {
	const edges = new Set<string>();
	const sourceFiles = walk(extensionsRoot, (path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
	const importPattern = /(?:from\s*|import\s*(?:\(\s*)?)(["'`])([^"'`]+)\1/g;

	for (const sourceFile of sourceFiles) {
		const from = relative(extensionsRoot, sourceFile).split(sep)[0];
		for (const match of readFileSync(sourceFile, "utf8").matchAll(importPattern)) {
			const specifier = match[2];
			if (!specifier.startsWith(".")) continue;
			const target = resolve(dirname(sourceFile), specifier);
			const targetRelative = relative(extensionsRoot, target);
			if (targetRelative.startsWith("..")) continue;
			const to = targetRelative.split(sep)[0];
			if (to && to !== from) edges.add(`${from} -> ${to}`);
		}
	}

	return [...edges].sort();
}

function documentedExtensionImports(rootReadme: string): string[] {
	const match = /<!-- extension-imports:start -->\s*```text\n([\s\S]*?)\n```\s*<!-- extension-imports:end -->/.exec(rootReadme);
	expect(match, "README.md must contain the checked extension-imports block").not.toBeNull();
	return match![1].split("\n").map((line) => line.trim()).filter(Boolean).sort();
}

function localMarkdownTargets(path: string): string[] {
	const markdown = readFileSync(path, "utf8");
	return [...markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
		.map((match) => match[1].trim().replace(/^<|>$/g, ""))
		.filter((target) => target && !/^(?:[a-z]+:|#)/i.test(target))
		.map((target) => decodeURIComponent(target.split("#", 1)[0]));
}

describe("documentation consistency", () => {
	test("indexes every extension directory in the root README", () => {
		const rootReadme = readFileSync(rootReadmePath, "utf8");
		for (const extension of extensionDirectories()) {
			expect(rootReadme).toContain(`(extensions/${extension}/)`);
			expect(existsSync(join(extensionsRoot, extension, "README.md"))).toBe(true);
		}
	});

	test("keeps code-bearing extension READMEs structurally complete", () => {
		for (const extension of extensionDirectories()) {
			if (!existsSync(join(extensionsRoot, extension, "index.ts"))) continue;
			const readme = readFileSync(join(extensionsRoot, extension, "README.md"), "utf8");
			expect(readme.startsWith(`# ${extension}\n`), `${extension} README heading`).toBe(true);
			expect(readme, `${extension} README dependencies`).toContain("## Dependencies");
		}
	});

	test("keeps the root direct-import graph synchronized with source", () => {
		const rootReadme = readFileSync(rootReadmePath, "utf8");
		expect(documentedExtensionImports(rootReadme)).toEqual(directExtensionImports());
	});

	test("keeps local Markdown links resolvable", () => {
		const markdownFiles = [rootReadmePath, ...walk(extensionsRoot, (path) => path.endsWith(".md"))];
		const missing: string[] = [];
		for (const markdownFile of markdownFiles) {
			for (const target of localMarkdownTargets(markdownFile)) {
				const resolved = resolve(dirname(markdownFile), target);
				if (!existsSync(resolved)) missing.push(`${relative(repositoryRoot, markdownFile)} -> ${target}`);
			}
		}
		expect(missing).toEqual([]);
	});
});
