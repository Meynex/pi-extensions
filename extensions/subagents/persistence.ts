import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ContextForkState } from "./context.js";
import { isAgentSnapshot, type AgentSnapshot } from "./lifecycle.js";
import type { AgentMailbox, AgentMailboxEvent } from "./mailbox.js";

export const AGENT_STATE_ENTRY_TYPE = "subagent-state";
export const MAILBOX_STATE_ENTRY_TYPE = "subagent-mailbox-state";

export type MailboxFinalState = "unread" | "delivered";

export interface PersistedMailboxState {
	version: 1;
	key: string;
	state: MailboxFinalState;
	event?: Omit<AgentMailboxEvent<AgentSnapshot>, "sequence">;
}

export interface PersistedAgentState {
	version: 1;
	id: string;
	state: "open" | "closed";
	agent?: AgentSnapshot;
	context?: ContextForkState;
	queuedMessages?: string[];
	completionDelivery?: "none" | "automatic" | "wait";
}

export interface RestoredAgentState {
	agent: AgentSnapshot;
	context: ContextForkState;
	queuedMessages: string[];
	completionDelivery: "none" | "automatic" | "wait";
}

function isContextForkState(value: unknown): value is ContextForkState {
	if (!value || typeof value !== "object") return false;
	const state = value as Record<string, unknown>;
	return typeof state.messageCount === "number"
		&& Number.isSafeInteger(state.messageCount)
		&& state.messageCount >= 0
		&& typeof state.initialEntryCount === "number"
		&& Number.isSafeInteger(state.initialEntryCount)
		&& state.initialEntryCount >= 0;
}

export function createAgentPersistence(pi: Pick<ExtensionAPI, "appendEntry">) {
	const persistOpen = (
		agent: AgentSnapshot,
		context: ContextForkState,
		queuedMessages: string[],
		completionDelivery: RestoredAgentState["completionDelivery"],
	): void => {
		pi.appendEntry(AGENT_STATE_ENTRY_TYPE, {
			version: 1,
			id: agent.id,
			state: "open",
			agent,
			context,
			queuedMessages: [...queuedMessages],
			completionDelivery,
		} satisfies PersistedAgentState);
	};

	const persistClosed = (id: string): void => {
		pi.appendEntry(AGENT_STATE_ENTRY_TYPE, {
			version: 1,
			id,
			state: "closed",
		} satisfies PersistedAgentState);
	};

	const restore = (ctx: any): RestoredAgentState[] => {
		const latest = new Map<string, PersistedAgentState>();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry?.type !== "custom" || entry.customType !== AGENT_STATE_ENTRY_TYPE) continue;
			const data = entry.data as PersistedAgentState | undefined;
			if (data?.version !== 1 || typeof data.id !== "string" || (data.state !== "open" && data.state !== "closed")) continue;
			latest.set(data.id, data);
		}
		const restored: RestoredAgentState[] = [];
		for (const data of latest.values()) {
			if (data.state !== "open" || !isAgentSnapshot(data.agent) || data.agent.id !== data.id || !isContextForkState(data.context)) continue;
			const queuedMessages = data.queuedMessages;
			if (!Array.isArray(queuedMessages) || queuedMessages.length > 4 || queuedMessages.some((message) => typeof message !== "string")) continue;
			const completionDelivery = data.completionDelivery;
			if (completionDelivery !== "none" && completionDelivery !== "automatic" && completionDelivery !== "wait") continue;
			restored.push({ agent: data.agent, context: data.context, queuedMessages: [...queuedMessages], completionDelivery });
		}
		return restored;
	};

	return { persistOpen, persistClosed, restore };
}

function mailboxEventKey(event: Pick<AgentMailboxEvent, "agentId" | "createdAt" | "persistenceKey">): string {
	return event.persistenceKey ?? `${event.agentId}:${event.createdAt}`;
}

export function createMailboxPersistence(
	pi: Pick<ExtensionAPI, "appendEntry">,
	mailbox: AgentMailbox<AgentSnapshot>,
) {
	const persistFinal = (event: AgentMailboxEvent<AgentSnapshot>, state: MailboxFinalState): void => {
		if (event.kind !== "final") return;
		const persisted: PersistedMailboxState = state === "unread"
			? {
				version: 1,
				key: mailboxEventKey(event),
				state,
				event: {
					kind: event.kind,
					agentId: event.agentId,
					agentName: event.agentName,
					content: event.content,
					createdAt: event.createdAt,
					persistenceKey: event.persistenceKey,
					status: event.status,
					final: event.final,
					omittedBefore: event.omittedBefore,
				},
			}
			: { version: 1, key: mailboxEventKey(event), state };
		pi.appendEntry(MAILBOX_STATE_ENTRY_TYPE, persisted);
	};

	const restoreFinals = (ctx: any): void => {
		const latest = new Map<string, PersistedMailboxState>();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry?.type !== "custom" || entry.customType !== MAILBOX_STATE_ENTRY_TYPE) continue;
			const data = entry.data as PersistedMailboxState | undefined;
			if (data?.version !== 1 || typeof data.key !== "string" || (data.state !== "unread" && data.state !== "delivered")) continue;
			latest.set(data.key, data);
		}
		for (const data of latest.values()) {
			const event = data.state === "unread" ? data.event : undefined;
			if (!event || event.kind !== "final" || !isAgentSnapshot(event.final) || typeof event.agentId !== "string" || typeof event.agentName !== "string" || typeof event.content !== "string" || typeof event.createdAt !== "number") continue;
			if ((event.persistenceKey !== undefined && typeof event.persistenceKey !== "string") || mailboxEventKey(event) !== data.key) continue;
			mailbox.restore(event);
		}
	};

	return { persistFinal, restoreFinals };
}
