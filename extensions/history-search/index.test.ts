import { expect, test } from "bun:test";
import { createSubagentNavigationEditorFactory } from "../subagents/navigation";
import historySearch from "./index";

const identity = (text: string) => text;
const editorTheme = {
	borderColor: identity,
	selectList: {
		selectedPrefix: identity,
		selectedText: identity,
		description: identity,
		scrollInfo: identity,
		noMatch: identity,
	},
};

test("preserves an earlier input decorator", () => {
	const handlers = new Map<string, (...args: any[]) => any>();
	historySearch({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);
	let opened = 0;
	let currentFactory: any = createSubagentNavigationEditorFactory(undefined, () => {
		opened += 1;
		return true;
	});
	const ctx = {
		mode: "tui",
		sessionManager: { getBranch: () => [] },
		ui: {
			getEditorComponent: () => currentFactory,
			setEditorComponent: (factory: any) => { currentFactory = factory; },
		},
	};
	const tui = { terminal: { rows: 24, columns: 80 }, requestRender() {} };

	handlers.get("session_start")?.({}, ctx);
	const editor = currentFactory(tui, editorTheme, { matches: () => false });
	// Application cursor mode is the sequence emitted by some terminals.
	editor.handleInput("\x1bOC");

	expect(opened).toBe(1);
});

test("searches newest matching prompts, cycles results, and restores drafts on cancel", () => {
	const handlers = new Map<string, (...args: any[]) => any>();
	historySearch({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);
	let currentFactory: any;
	const ctx = {
		mode: "tui",
		sessionManager: {
			getBranch: () => [
				{ type: "message", message: { role: "user", content: "older foo" } },
				{ type: "message", message: { role: "assistant", content: "ignored" } },
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "latest foo" }] } },
			],
		},
		ui: {
			getEditorComponent: () => currentFactory,
			setEditorComponent: (factory: any) => { currentFactory = factory; },
		},
	};
	handlers.get("session_start")?.({}, ctx);
	const tui = { terminal: { rows: 24, columns: 80 }, requestRender() {} };
	const editor = currentFactory(tui, editorTheme, { matches: () => false });
	editor.setText("unfinished draft");

	editor.handleInput("\x12"); // Ctrl+R
	for (const char of "foo") editor.handleInput(char);
	expect(editor.getText()).toBe("latest foo");
	expect(editor.render(80).join("\n")).toContain("1/2");
	editor.handleInput("\x12");
	expect(editor.getText()).toBe("older foo");
	editor.handleInput("\x1b");
	expect(editor.getText()).toBe("unfinished draft");

	const installed = currentFactory;
	handlers.get("session_shutdown")?.({}, ctx);
	expect(currentFactory).not.toBe(installed);
});
