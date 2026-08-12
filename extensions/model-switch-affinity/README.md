# model-switch-affinity

Scopes provider session-affinity and prompt-cache identifiers to the selected
provider and model. This prevents OpenAI-compatible gateways from keeping a Pi
session pinned to the previous backend route after `/model` or model cycling.

The extension rewrites existing affinity values only. It does not add caching,
affinity headers, or request fields when the provider did not create them.
Values remain stable for repeated requests to the same provider/model, so cache
reuse and route affinity continue to work normally. Switching back to a model
restores that model's stable scope.

Recognized headers:

- `session_id` and `session-id`
- `x-affinity`
- `x-client-request-id`
- `x-session-affinity`
- `x-session-id`

Recognized request fields:

- `prompt_cache_key`
- `promptCacheKey`

## Dependencies

- **Runtime:** [Pi](https://github.com/earendil-works/pi-coding-agent) extension API and Node.js crypto.
- **Depends on extensions:** None.
- **Used by extensions:** None.
