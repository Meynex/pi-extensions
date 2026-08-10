import { beforeEach, describe, expect, test } from "bun:test";
import {
	enableExplorationToolRendering,
	renderExploration,
	renderExplorationCall,
	resetExplorationStateForTests,
} from "./exploration.js";
import { CYAN, GREEN, RESET } from "./render.js";

const theme = {
	bold: (text: string) => text,
	fg: (_color: string, text: string) => text,
};

const ANSI_PATTERN = /\x1b\[[0-9;:]*m/g;
const TEST_TAG_PATTERN = /<\/?(?:cyan|green)>|<\/>/g;

function plain(text: string): string {
	return text.replace(ANSI_PATTERN, "").replace(TEST_TAG_PATTERN, "");
}

function renderLines(component: { render(width: number): string[] } | undefined): string[] {
	return component?.render(120) ?? [];
}

describe("exploration live rendering", () => {
	beforeEach(() => {
		resetExplorationStateForTests();
		enableExplorationToolRendering();
	});

	test("shows colored settled grep match counts", () => {
		const lines = renderExploration(
			[{ verb: "Search", detail: "TODO in extensions/better-native-pi", summary: "7 matches in 3 files" }],
			false,
			theme,
			120,
		);
		const rendered = lines.join("\n");

		expect(plain(rendered)).toContain("Search TODO in extensions/better-native-pi · 7 matches in 3 files");
		expect(rendered).toContain(`${GREEN}7 matches${RESET} in ${CYAN}3 files${RESET}`);
	});

	test("shows grep output only when expanded", () => {
		const activity = {
			verb: "Search" as const,
			detail: "TODO in extensions/better-native-pi",
			summary: "2 matches in 1 file",
			output: "core.ts:1: TODO one\ncore.ts:2: TODO two",
		};
		const collapsed = renderExploration([activity], false, theme, 120).join("\n");
		const expanded = renderExploration([activity], false, theme, 120, { expanded: true }).join("\n");

		expect(plain(collapsed)).not.toContain("core.ts:1: TODO one");
		expect(plain(expanded)).toContain("core.ts:1: TODO one");
		expect(plain(expanded)).toContain("core.ts:2: TODO two");
	});

	test("does not render streamed path fragments before execution starts", () => {
		const partial = renderExplorationCall(
			"read",
			{ path: "/Users/stanislas.lange/.pi/agent/git/github.com/ang" },
			theme,
			{ isPartial: true, toolCallId: "call-1", executionStarted: false },
		);

		expect(renderLines(partial)).toEqual([]);

		const started = renderExplorationCall(
			"read",
			{ path: "/Users/stanislas.lange/.pi/agent/git/github.com/angristan/pi-extensions/extensions/goal/index.ts" },
			theme,
			{ isPartial: true, toolCallId: "call-1", executionStarted: true },
		);

		const rendered = renderLines(started).join("\n");
		expect(rendered).toContain("Exploring");
		expect(rendered).toContain("index.ts");
		expect(rendered).not.toContain("Read ang in");
	});
});
