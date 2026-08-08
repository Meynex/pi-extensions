import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

function userText(entry: any): string | undefined {
	if (entry.type !== "message" || entry.message?.role !== "user") return;
	const content = entry.message.content;
	const text = typeof content === "string"
		? content
		: Array.isArray(content)
			? content.filter((item: any) => item?.type === "text").map((item: any) => item.text).join("\n")
			: "";
	return text.trim() || undefined;
}

export function createHistorySearchEditorFactory(previousFactory: any, prompts: string[]) {
	return (tui: any, theme: any, keybindings: any) => {
		const editor: CustomEditor = previousFactory
			? previousFactory(tui, theme, keybindings)
			: new CustomEditor(tui, theme, keybindings);
		const handleInput = editor.handleInput.bind(editor);
		const render = editor.render.bind(editor);
		let searching = false;
		let query = "";
		let original = "";
		let matches: string[] = [];
		let matchIndex = 0;

		const refreshMatches = (reset = false) => {
			const normalizedQuery = query.toLowerCase();
			matches = normalizedQuery
				? [...prompts].reverse().filter((prompt, index, all) => prompt.toLowerCase().includes(normalizedQuery) && all.indexOf(prompt) === index)
				: [];
			if (reset) matchIndex = 0;
			if (matches.length) editor.setText(matches[matchIndex % matches.length]!);
			else editor.setText(original);
			tui.requestRender();
		};
		const beginSearch = () => {
			searching = true;
			query = "";
			original = editor.getText();
			matches = [];
			matchIndex = 0;
			tui.requestRender();
		};
		const cancelSearch = () => {
			searching = false;
			editor.setText(original);
			tui.requestRender();
		};
		const acceptSearch = () => {
			searching = false;
			tui.requestRender();
		};

		editor.handleInput = (data: string) => {
			if (!searching && matchesKey(data, "ctrl+r")) return beginSearch();
			if (!searching) return handleInput(data);

			if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) return cancelSearch();
			if (matchesKey(data, Key.enter)) return acceptSearch();
			if (matchesKey(data, "ctrl+r") || matchesKey(data, Key.up)) {
				if (matches.length) matchIndex = (matchIndex + 1) % matches.length;
				return refreshMatches();
			}
			if (matchesKey(data, "ctrl+s") || matchesKey(data, Key.down)) {
				if (matches.length) matchIndex = (matchIndex - 1 + matches.length) % matches.length;
				return refreshMatches();
			}
			if (matchesKey(data, Key.backspace) || data === "\x7f") {
				query = query.slice(0, -1);
				return refreshMatches(true);
			}
			if (matchesKey(data, "ctrl+u")) {
				query = "";
				return refreshMatches(true);
			}
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				query += data;
				return refreshMatches(true);
			}
		};

		editor.render = (width: number) => {
			const lines = render(width);
			if (!searching) return lines;
			const status = !query ? "" : matches.length ? `${matchIndex + 1}/${matches.length}` : "no match";
			const footer = `reverse-i-search: ${query}${status ? `  ${status}` : ""}  Enter accept · Esc cancel`;
			lines.push(truncateToWidth(footer, width, "…"));
			return lines;
		};
		return editor;
	};
}

export default function (pi: ExtensionAPI) {
	let prompts: string[] = [];
	// Capture the editor factory installed before us (e.g. accent-color's
	// border-locking wrapper) and delegate to it for normal input. This keeps
	// reverse-i-search composable regardless of which extension loads last.
	let previousFactory: any;
	let installedFactory: any;

	pi.on("input", (event) => {
		if (event.source === "interactive" && event.text.trim() && !event.text.startsWith("/")) prompts.push(event.text);
	});
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		prompts = ctx.sessionManager.getBranch().map(userText).filter((text): text is string => Boolean(text));
		previousFactory = ctx.ui.getEditorComponent();
		installedFactory = createHistorySearchEditorFactory(previousFactory, prompts);
		ctx.ui.setEditorComponent(installedFactory);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		// Only restore our predecessor when this wrapper still owns the editor.
		if (ctx.ui.getEditorComponent() === installedFactory) {
			ctx.ui.setEditorComponent(previousFactory);
		}
		previousFactory = undefined;
		installedFactory = undefined;
	});
}
