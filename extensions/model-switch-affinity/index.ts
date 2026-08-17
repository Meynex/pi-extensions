import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AFFINITY_HEADERS = new Set([
	"session_id",
	"session-id",
	"x-affinity",
	"x-client-request-id",
	"x-session-affinity",
	"x-session-id",
]);
const AFFINITY_PAYLOAD_FIELDS = ["prompt_cache_key", "promptCacheKey"] as const;
const PASSTHROUGH_PROVIDERS = new Set(["foundry-openai"]);

function modelScope(ctx: any): { provider: string; model: string } | undefined {
	const provider = ctx.model?.provider;
	const model = ctx.model?.id;
	if (typeof provider !== "string" || typeof model !== "string") return;
	// The Foundry proxy treats non-UUIDv7 session IDs as legacy and routes them
	// to the default upstream. Leave its affinity values untouched so local
	// Foundry-specific extensions can rotate fresh UUIDv7 IDs when needed.
	if (PASSTHROUGH_PROVIDERS.has(provider)) return;
	return { provider, model };
}

/** Produce a stable UUID-shaped affinity value for one provider/model route. */
export function scopeAffinityValue(seed: string, provider: string, model: string): string {
	const hex = createHash("sha256")
		.update(seed)
		.update("\0")
		.update(provider)
		.update("\0")
		.update(model)
		.digest("hex")
		.slice(0, 32)
		.split("");

	// Keep strict gateways happy by emitting an RFC 4122 version/variant shape.
	hex[12] = "5";
	hex[16] = "8";
	const value = hex.join("");
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function scopeAffinityHeaders(
	headers: Record<string, string | null>,
	provider: string,
	model: string,
): void {
	for (const [name, value] of Object.entries(headers)) {
		if (typeof value !== "string" || !AFFINITY_HEADERS.has(name.toLowerCase())) continue;
		headers[name] = scopeAffinityValue(value, provider, model);
	}
}

export function scopeAffinityPayload(payload: unknown, provider: string, model: string): unknown | undefined {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return;

	const input = payload as Record<string, unknown>;
	let output: Record<string, unknown> | undefined;
	for (const field of AFFINITY_PAYLOAD_FIELDS) {
		const value = input[field];
		if (typeof value !== "string") continue;
		output ??= { ...input };
		output[field] = scopeAffinityValue(value, provider, model);
	}
	return output;
}

export default function modelSwitchAffinity(pi: ExtensionAPI) {
	pi.on("before_provider_headers", (event, ctx) => {
		const scope = modelScope(ctx);
		if (!scope) return;
		scopeAffinityHeaders(event.headers, scope.provider, scope.model);
	});

	pi.on("before_provider_request", (event, ctx) => {
		const scope = modelScope(ctx);
		if (!scope) return;
		return scopeAffinityPayload(event.payload, scope.provider, scope.model);
	});
}
