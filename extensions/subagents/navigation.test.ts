import { expect, test } from "bun:test";
import { createSubagentNavigationEditorFactory } from "./navigation";

test("opens the first child only when Right is pressed on empty input", () => {
	let text = "";
	let expandedText: string | undefined;
	const delegated: string[] = [];
	const editor = {
		getText: () => text,
		getExpandedText: () => expandedText ?? text,
		handleInput: (data: string) => delegated.push(data),
	};
	let opens = 0;
	const factory = createSubagentNavigationEditorFactory(() => editor, () => {
		opens += 1;
		return true;
	});
	const wrapped = factory({}, {}, {});

	wrapped.handleInput("\x1b[C");
	expect(opens).toBe(1);
	expect(delegated).toEqual([]);

	expandedText = " \n";
	wrapped.handleInput("\x1b[C");
	expect(opens).toBe(2);

	expandedText = "draft";
	wrapped.handleInput("\x1b[C");
	wrapped.handleInput("\x1b[D");
	expect(opens).toBe(2);
	expect(delegated).toEqual(["\x1b[C", "\x1b[D"]);
});

test("keeps native Right behavior when no child can open", () => {
	const delegated: string[] = [];
	const editor = {
		getText: () => "",
		handleInput: (data: string) => delegated.push(data),
	};
	const wrapped = createSubagentNavigationEditorFactory(() => editor, () => false)({}, {}, {});

	wrapped.handleInput("\x1b[C");
	expect(delegated).toEqual(["\x1b[C"]);
});
