import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { HerdrAgentClient, HerdrSurfaceManager, type ExecResult } from "./herdr";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

function success(result: unknown): ExecResult {
	return { code: 0, stdout: JSON.stringify({ result }), stderr: "" };
}

class FakeSocket extends EventEmitter {
	destroyed = false;
	timeoutMs?: number;
	destroyError?: Error;
	setNoDelay() { return this; }
	setTimeout(value: number) { this.timeoutMs = value; return this; }
	write() { return true; }
	destroy(error?: Error) {
		this.destroyed = true;
		this.destroyError = error;
		if (error) this.emit("error", error);
		this.emit("close");
		return this;
	}
}

describe("Herdr subagent surfaces", () => {
	test("serializes concurrent children into one unfocused tab with master names", async () => {
		const calls: string[][] = [];
		let nextPane = 1;
		const manager = new HerdrSurfaceManager(async (_command, args) => {
			calls.push(args);
			if (args[0] === "tab" && args[1] === "create") {
				await Bun.sleep(5);
				return success({ tab: { tab_id: "tab-agents" }, root_pane: { pane_id: `pane-${nextPane++}` } });
			}
			if (args[0] === "pane" && args[1] === "layout") {
				return success({ layout: { panes: [{ pane_id: "pane-1", rect: { width: 120, height: 40 } }] } });
			}
			if (args[0] === "pane" && args[1] === "split") return success({ pane: { pane_id: `pane-${nextPane++}` } });
			return success({});
		}, "workspace-1");
		const reviewer = { agentId: "a", name: "reviewer" };
		const tester = { agentId: "b", name: "tester" };

		const [first, second] = await Promise.all([
			manager.ensurePane(reviewer, "/repo"),
			manager.ensurePane(tester, "/repo"),
		]);

		expect([first, second]).toEqual(["pane-1", "pane-2"]);
		expect(calls.filter((args) => args[0] === "tab" && args[1] === "create")).toHaveLength(1);
		expect(calls.find((args) => args[0] === "tab" && args[1] === "create")).toEqual([
			"tab", "create", "--workspace", "workspace-1", "--cwd", "/repo", "--label", "Subagents", "--no-focus",
		]);
		expect(calls.find((args) => args[0] === "pane" && args[1] === "split")).toEqual([
			"pane", "split", "pane-1", "--direction", "right", "--cwd", "/repo", "--no-focus",
		]);
		expect(calls.filter((args) => args[0] === "pane" && args[1] === "rename")).toEqual([
			["pane", "rename", "pane-1", "reviewer"],
			["pane", "rename", "pane-2", "tester"],
		]);
	});

	test("accepts Herdr pane run success without JSON output", async () => {
		const manager = new HerdrSurfaceManager(async (_command, args) => {
			expect(args).toEqual(["pane", "run", "pane-1", "echo ok"]);
			return { code: 0, stdout: "", stderr: "" };
		}, "workspace-1");
		await expect(manager.runCommand("pane-1", "echo ok")).resolves.toBeUndefined();
	});

	test("controls a visible child through IPC without reading its pane", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-herdr-client-test-"));
		cleanup.push(() => rm(directory, { recursive: true, force: true }));
		let command = "";
		let interrupted = false;
		const surfaces = {
			async ensurePane(state: any) { state.paneId = "pane-visible"; return state.paneId; },
			async runCommand(_paneId: string, value: string) {
				command = value;
				const launcherPath = value.match(/^'([^']+)'$/)?.[1];
				if (!launcherPath) throw new Error("missing private launcher path");
				const launcher = await readFile(launcherPath, "utf8");
				const socketPath = launcher.match(/PI_SUBAGENT_BRIDGE_SOCKET='([^']+)'/)?.[1];
				const token = launcher.match(/PI_SUBAGENT_BRIDGE_TOKEN='([^']+)'/)?.[1];
				const agentId = launcher.match(/PI_SUBAGENT_PARENT_ID='([^']+)'/)?.[1];
				if (!socketPath || !token || !agentId) throw new Error("missing bridge environment");
				const socket = net.createConnection(socketPath);
				let buffer = "";
				socket.on("connect", () => socket.write(`${JSON.stringify({ type: "hello", token, agentId })}\n`));
				socket.on("data", (chunk) => {
					buffer += chunk.toString();
					for (;;) {
						const newline = buffer.indexOf("\n");
						if (newline < 0) break;
						const request = JSON.parse(buffer.slice(0, newline));
						buffer = buffer.slice(newline + 1);
						socket.write(`${JSON.stringify({ type: "response", id: request.id, command: request.type, success: true })}\n`);
						if (request.type === "prompt") {
							socket.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Visible result" }] } })}\n`);
						}
						if (request.type === "shutdown") queueMicrotask(() => socket.end());
					}
				});
			},
			async interrupt() { interrupted = true; },
			async waitUntilIdle() { return true; },
			async closePane() {},
		};
		const client = new HerdrAgentClient({
			command: "pi",
			args: ["--session", join(directory, "context.jsonl"), "--name", "reviewer", "--no-auto-title"],
			cwd: "/repo",
			env: { PI_SUBAGENT_CHILD: "1", PI_SUBAGENT_PARENT_ID: "reviewer-1" },
			herdr: { agentId: "reviewer-1", name: "reviewer" },
		}, surfaces as any);
		const events: any[] = [];
		client.onEvent((event) => events.push(event));

		await client.start();
		await client.prompt("Inspect the code");
		await Bun.sleep(0);
		expect(command).toMatch(/pi-subagent-bridge-.+\/run-child/);
		expect(command).not.toContain("PI_SUBAGENT_BRIDGE_TOKEN");
		expect(events).toContainEqual(expect.objectContaining({ type: "message_end", message: expect.objectContaining({ role: "assistant" }) }));
		await client.stop();
		expect(interrupted).toBe(false);
	});

	test("rejects invalid launcher environment names", async () => {
		const client = new HerdrAgentClient({
			command: "pi",
			args: ["--session", "/tmp/context.jsonl"],
			cwd: "/repo",
			env: { GOOD_NAME: "ok", "BAD-NAME": "boom" } as Record<string, string>,
			herdr: { agentId: "reviewer-1", name: "reviewer" },
		}, {
			async ensurePane() { throw new Error("ensurePane should not run"); },
			async runCommand() {},
			async interrupt() {},
			async waitUntilIdle() { return true; },
			async closePane() {},
		} as any);

		await expect(client.start()).rejects.toThrow("Invalid shell environment variable name: BAD-NAME");
	});

	test("times out and limits unauthenticated bridge connections", async () => {
		const client = new HerdrAgentClient({
			command: "pi",
			args: [],
			cwd: "/repo",
			herdr: { agentId: "reviewer-1", name: "reviewer" },
		}, {} as any);
		(client as any).resolveReady = () => undefined;

		const sockets = Array.from({ length: 5 }, () => new FakeSocket());
		for (const socket of sockets) (client as any).accept(socket as any, "secret");

		expect(sockets[0]!.timeoutMs).toBe(5_000);
		expect(sockets[3]!.timeoutMs).toBe(5_000);
		expect(sockets[4]!.destroyed).toBe(true);
		expect(sockets[4]!.destroyError?.message).toContain("Too many pending child bridge connections");

		sockets[0]!.emit("timeout");
		expect(sockets[0]!.destroyed).toBe(true);
		expect(sockets[0]!.destroyError?.message).toContain("Timed out waiting for child bridge authentication");

		const authenticated = new FakeSocket();
		(client as any).accept(authenticated as any, "secret");
		authenticated.emit("data", `${JSON.stringify({ type: "hello", token: "secret", agentId: "reviewer-1" })}\n`);
		expect(authenticated.timeoutMs).toBe(0);
		expect((client as any).socket).toBe(authenticated);
	});

	test("surfaces server close failures during transport cleanup", async () => {
		const client = new HerdrAgentClient({
			command: "pi",
			args: [],
			cwd: "/repo",
			herdr: { agentId: "reviewer-1", name: "reviewer" },
		}, {} as any);
		(client as any).server = {
			listening: true,
			close(callback: (error?: Error | undefined) => void) { callback(new Error("close failed")); },
		};

		await expect((client as any).closeTransport()).rejects.toThrow("close failed");
	});

	test("ignores already-closed bridge servers during transport cleanup", async () => {
		const client = new HerdrAgentClient({
			command: "pi",
			args: [],
			cwd: "/repo",
			herdr: { agentId: "reviewer-1", name: "reviewer" },
		}, {} as any);
		(client as any).server = {
			listening: false,
			close(callback: (error?: NodeJS.ErrnoException | undefined) => void) {
				callback(Object.assign(new Error("not running"), { code: "ERR_SERVER_NOT_RUNNING" }));
			},
		};

		await expect((client as any).closeTransport()).resolves.toBeUndefined();
	});

	test("preserves startup failures while still attempting cleanup", async () => {
		let closedPane = false;
		const client = new HerdrAgentClient({
			command: "pi",
			args: [],
			cwd: "/repo",
			env: { "BAD-NAME": "boom" } as Record<string, string>,
			herdr: { agentId: "reviewer-1", name: "reviewer" },
		}, {
			async ensurePane() { throw new Error("ensurePane should not run"); },
			async runCommand() {},
			async interrupt() {},
			async waitUntilIdle() { return true; },
			async closePane() { closedPane = true; },
		} as any);
		(client as any).closeTransport = async () => { throw new Error("cleanup failed"); };

		await expect(client.start()).rejects.toThrow("Invalid shell environment variable name: BAD-NAME");
		expect(closedPane).toBe(true);
	});
});
