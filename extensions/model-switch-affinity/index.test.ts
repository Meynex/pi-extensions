import { expect, test } from "bun:test";
import modelSwitchAffinity, {
	scopeAffinityHeaders,
	scopeAffinityPayload,
	scopeAffinityValue,
} from "./index";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;

test("creates stable model-scoped affinity values", () => {
	const first = scopeAffinityValue("session-1", "provider-a", "model-a");
	expect(first).toMatch(UUID);
	expect(scopeAffinityValue("session-1", "provider-a", "model-a")).toBe(first);
	expect(scopeAffinityValue("session-1", "provider-a", "model-b")).not.toBe(first);
	expect(scopeAffinityValue("session-1", "provider-b", "model-a")).not.toBe(first);
});

test("rewrites known affinity headers without touching unrelated headers", () => {
	const headers: Record<string, string | null> = {
		Authorization: "Bearer secret",
		Session_Id: "session-1",
		"x-client-request-id": "session-1",
		"x-session-affinity": null,
	};

	scopeAffinityHeaders(headers, "provider-a", "model-a");

	expect(headers.Authorization).toBe("Bearer secret");
	expect(headers.Session_Id).toMatch(UUID);
	expect(headers["x-client-request-id"]).toBe(headers.Session_Id);
	expect(headers["x-session-affinity"]).toBeNull();
});

test("rewrites existing cache keys without mutating the original payload", () => {
	const payload = {
		model: "model-a",
		prompt_cache_key: "session-1",
		promptCacheKey: "session-1",
	};
	const output = scopeAffinityPayload(payload, "provider-a", "model-a") as typeof payload;

	expect(output).not.toBe(payload);
	expect(output.model).toBe("model-a");
	expect(output.prompt_cache_key).toMatch(UUID);
	expect(output.promptCacheKey).toBe(output.prompt_cache_key);
	expect(payload.prompt_cache_key).toBe("session-1");
	expect(scopeAffinityPayload({ model: "model-a" }, "provider-a", "model-a")).toBeUndefined();
});

test("request hooks preserve Foundry affinity values", () => {
	const handlers = new Map<string, (...args: any[]) => any>();
	modelSwitchAffinity({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);

	const headers = { session_id: "01a01010-f0dd-7dab-a2c9-a2aa5a2545a7" };
	const ctx = { model: { provider: "foundry-openai", id: "gpt-5.6-sol" } };
	const payload = { prompt_cache_key: headers.session_id };

	handlers.get("before_provider_headers")?.({ headers }, ctx);
	const output = handlers.get("before_provider_request")?.({ payload }, ctx);

	expect(headers.session_id).toBe("01a01010-f0dd-7dab-a2c9-a2aa5a2545a7");
	expect(output).toBeUndefined();
});

test("request hooks change affinity when the selected model changes", () => {
	const handlers = new Map<string, (...args: any[]) => any>();
	modelSwitchAffinity({ on: (name: string, handler: any) => handlers.set(name, handler) } as any);

	const headers = { session_id: "session-1" };
	const ctx = { model: { provider: "provider-a", id: "model-a" } };
	handlers.get("before_provider_headers")?.({ headers }, ctx);
	const firstHeader = headers.session_id;
	const firstPayload = handlers.get("before_provider_request")?.(
		{ payload: { prompt_cache_key: "session-1" } },
		ctx,
	);

	ctx.model.id = "model-b";
	const secondPayload = handlers.get("before_provider_request")?.(
		{ payload: { prompt_cache_key: "session-1" } },
		ctx,
	);

	expect(firstPayload.prompt_cache_key).toBe(firstHeader);
	expect(secondPayload.prompt_cache_key).not.toBe(firstPayload.prompt_cache_key);
});
