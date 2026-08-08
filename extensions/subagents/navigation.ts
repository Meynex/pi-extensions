import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";

type EditorLike = {
	getText(): string;
	getExpandedText?(): string;
	handleInput(data: string): void;
};

/** Preserve the installed editor and reserve Right only when its input is empty. */
export function createSubagentNavigationEditorFactory(previousFactory: any, openFirstAgent: () => boolean) {
	return (tui: any, theme: any, keybindings: any) => {
		const editor: EditorLike = previousFactory
			? previousFactory(tui, theme, keybindings)
			: new CustomEditor(tui, theme, keybindings);
		const handleInput = editor.handleInput.bind(editor);
		editor.handleInput = (data: string) => {
			const text = editor.getExpandedText?.() ?? editor.getText();
			if (matchesKey(data, Key.right) && text.trim() === "" && openFirstAgent()) return;
			handleInput(data);
		};
		return editor;
	};
}
