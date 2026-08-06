import { expect, test } from "bun:test";
import cachedLineResets from "./index";

const IMAGE = "\x1b_Ga=T,f=100,C=1,c=40,r=2,i=7;payload\x1b\\";

test("caches repeated line normalization and stable Kitty image positions", () => {
	const handlers = new Map<string, (...args: any[]) => any>();
	let widgetFactory: any;
	cachedLineResets({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);
	const ctx = {
		mode: "tui",
		ui: { setWidget(_key: string, value: any) { widgetFactory = value; } },
	};
	let calls = 0;
	const originalLineResets = (lines: string[]) => {
		calls += lines.length;
		return lines.map((line) => `${line}!`);
	};
	const originalImageRange = (firstChanged: number, lastChanged: number) => ({
		firstChanged,
		lastChanged,
	});
	const tui: any = {
		applyLineResets: originalLineResets,
		expandChangedRangeForKittyImages: originalImageRange,
		getKittyImageReservedRows: (lines: string[], index: number) => lines[index]?.includes("\x1b_G") ? 2 : 1,
		previousLines: ["Working (1s)", IMAGE, "", "footer"],
	};

	handlers.get("session_start")?.({}, ctx);
	const host = widgetFactory(tui);
	expect(tui.applyLineResets(["same", "same"])).toEqual(["same!", "same!"]);
	expect(tui.applyLineResets(["same"])).toEqual(["same!"]);
	expect(calls).toBe(1);

	// The timer changes above an identical image, but its row and payload remain
	// stable, so only the timer line belongs to the changed range.
	expect(tui.expandChangedRangeForKittyImages(0, 0, ["Working (2s)", IMAGE, "", "footer"])).toEqual({
		firstChanged: 0,
		lastChanged: 0,
	});

	// Moving or changing an image still expands through all of its reserved rows.
	expect(tui.expandChangedRangeForKittyImages(1, 1, ["Working (2s)", "inserted", IMAGE, "", "footer"])).toEqual({
		firstChanged: 1,
		lastChanged: 3,
	});
	expect(tui.expandChangedRangeForKittyImages(1, 1, ["Working (2s)", IMAGE.replace("payload", "changed"), "", "footer"])).toEqual({
		firstChanged: 1,
		lastChanged: 2,
	});

	host.dispose();
	expect(tui.applyLineResets).toBe(originalLineResets);
	expect(tui.expandChangedRangeForKittyImages).toBe(originalImageRange);
});

test("does not recurse through Pi's forwarding TUI reference", () => {
	const handlers = new Map<string, (...args: any[]) => any>();
	let widgetFactory: any;
	cachedLineResets({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);
	const ctx = {
		mode: "tui",
		ui: { setWidget(_key: string, value: any) { widgetFactory = value; } },
	};

	let calls = 0;
	class Renderer {
		previousLines: string[] = [];
		applyLineResets(lines: string[]): string[] {
			calls += lines.length;
			return lines.map((line) => `${line}!`);
		}
		expandChangedRangeForKittyImages(firstChanged: number, lastChanged: number): any {
			return { firstChanged, lastChanged };
		}
		getKittyImageReservedRows(): number { return 1; }
	}
	const renderer = new Renderer();
	const tui = new Proxy({} as any, {
		get: (_target, property) => {
			const value = Reflect.get(renderer, property, renderer);
			if (typeof value !== "function") return value;
			return (...args: any[]) => Reflect.apply(Reflect.get(renderer, property, renderer), renderer, args);
		},
		set: (_target, property, value) => Reflect.set(renderer, property, value, renderer),
		deleteProperty: (_target, property) => Reflect.deleteProperty(renderer, property),
		getPrototypeOf: () => Reflect.getPrototypeOf(renderer),
	});

	handlers.get("session_start")?.({}, ctx);
	const host = widgetFactory(tui);
	expect(tui.applyLineResets(["same", "same"])).toEqual(["same!", "same!"]);
	expect(tui.applyLineResets(["same"])).toEqual(["same!"]);
	expect(calls).toBe(1);

	host.dispose();
	expect(tui.applyLineResets(["after dispose"])).toEqual(["after dispose!"]);
	expect(calls).toBe(2);

	// The proxy keeps the inactive symbol state on the renderer because it does
	// not forward property deletion. A reload must still install a fresh cache.
	handlers.get("session_start")?.({}, ctx);
	const reloadedHost = widgetFactory(tui);
	expect(tui.applyLineResets(["after reload"])).toEqual(["after reload!"]);
	expect(tui.applyLineResets(["after reload"])).toEqual(["after reload!"]);
	expect(calls).toBe(3);
	reloadedHost.dispose();
});
