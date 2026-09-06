import { expect, test } from "bun:test";
import { createAgentLifecycle, type ManagedAgent } from "./lifecycle";
import type { AgentClient } from "./rpc";

test("closeAgent attempts fork cleanup after surface disposal fails", async () => {
	let cleanedUp = 0;
	const lifecycle = createAgentLifecycle({
		createClient() { throw new Error("unused"); },
		reportToolName: "report_to_parent",
		maxReportChars: 1_000,
		assertCurrentSession() {},
		publishMailboxEvent() {},
		discardMailboxEvents() {},
		recordUsage() {},
		checkpointAgent() {},
		updateOverlay() {},
		refreshTranscript() {},
		trimClosed() {},
		async cleanupClientOptions() {
			throw new Error("surface failed");
		},
	});
	const client: AgentClient = {
		async start() {},
		async stop() {},
		async prompt() {},
		async steer() {},
		async abort() {},
		onEvent() { return () => {}; },
		onExit() { return () => {}; },
		getStderr() { return ""; },
	};
	const agent: ManagedAgent = {
		id: "agent-1",
		name: "agent",
		task: "task",
		contextMode: "fresh",
		status: "running",
		cwd: "/repo",
		startedAt: 0,
		output: "",
		activity: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		client,
		clientOptions: { command: "pi", args: [], cwd: "/repo" },
		fork: {
			directory: "/tmp/agent-1",
			sessionFile: "/tmp/agent-1/context.jsonl",
			messageCount: 0,
			initialEntryCount: 0,
			async cleanup() {
				cleanedUp += 1;
				throw new Error("fork failed");
			},
		},
		completion: Promise.resolve(),
		resolveCompletion() {},
		runSettled: false,
		waiting: 0,
		queuedMessages: [],
		pendingReports: new Map(),
		completionDelivery: "none",
		suppressNotifications: false,
		generation: 0,
		cleanupComplete: false,
		transitioning: false,
	};

	const error = await lifecycle.closeAgent(agent).then(
		() => undefined,
		(caught) => caught,
	);

	expect(cleanedUp).toBe(1);
	expect(error).toBeInstanceOf(AggregateError);
	expect((error as AggregateError).errors).toHaveLength(2);
	expect((error as AggregateError).errors.map((entry) => entry instanceof Error ? entry.message : String(entry))).toEqual([
		"surface failed",
		"fork failed",
	]);
});
