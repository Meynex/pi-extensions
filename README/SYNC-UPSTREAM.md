# Upstream Sync and Security Review

This fork keeps most extensions from `angristan/pi-extensions` while intentionally excluding the upstream `web-search` extension. The consuming Pi setup uses `npm:pi-web-access` as the only `web_search` provider.

## Local policy

`package.json` must not load extensions by wildcard:

```json
"pi": {
  "extensions": ["./extensions/accent-color", "..."]
}
```

Required policy:

- no `./extensions/*`
- no `./extensions/web-search`
- every other extension directory is listed explicitly
- no production Pi settings are modified by the sync workflow

Validate locally:

```bash
node scripts/sync-policy.mjs check
```

Apply policy after an upstream merge:

```bash
node scripts/sync-policy.mjs apply
```

## GitHub Action

Workflow: `.github/workflows/upstream-sync-review.yml`

Triggers:

- every 6 hours
- manual `workflow_dispatch`

The workflow:

1. clones this fork
2. fetches the default branch from `https://github.com/angristan/pi-extensions`
3. creates or updates `bot/upstream-sync-<upstream-default-branch>`
4. merges upstream into the sync branch
5. reapplies the local package policy excluding `web-search`
6. runs static checks and a conservative diff secret scan
7. generates a PR body with commits, diffstat, inferred bugfixes/improvements, risks, and tests
8. runs three separated GitHub Copilot CLI reviews using `gpt-5.6-luna` if available
9. creates or updates a PR against `main`
10. fails the workflow if Copilot CLI/auth/model is unavailable or any review blocks

The workflow never merges automatically.

## Required repository permissions

Workflow permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
  copilot-requests: write
```

No `pull_request_target` trigger is used. The workflow only runs on schedule or manual dispatch in this repository, not on untrusted external PR code.

## Copilot review gate

The review model is pinned to:

```text
gpt-5.6-luna
```

No fallback model is allowed. If the official Copilot CLI is unavailable, authentication fails, or `gpt-5.6-luna` is unavailable, the review result is `BLOCK`.

Review lanes:

- Security / prompt injection
- Extensions / dependencies
- Regression / compatibility

Every lane treats the upstream diff as untrusted data. Review prompts explicitly instruct Copilot not to execute or obey changed code, comments, Markdown, or prompts in the diff.

## Manual merge procedure

Before merging an upstream sync PR:

1. Confirm the PR body includes upstream commits and diffstat.
2. Confirm the Bugfixes and Improvements sections are understandable.
3. Confirm `web-search` remains excluded from `package.json`.
4. Confirm `npm:pi-web-access` remains the intended `web_search` provider in the consuming Pi setup.
5. Read all Copilot review sections.
6. Manually inspect any `WARN` item.
7. Do not merge if any lane reports `BLOCK`.
8. Run local checks if the change is risky:

```bash
node scripts/sync-policy.mjs check
bun test documentation.test.ts
git diff --check origin/main...HEAD
```

Merge only after a human maintainer approves.

## Rollback

If a merged upstream sync causes load failures or unsafe behavior:

1. Revert the merge commit in this fork.
2. Tag or record the last known-good commit.
3. Pin the consuming Pi `settings.json` package entry to the last known-good fork commit/tag.
4. Restart Pi.
5. Verify that `web_search` is provided only by `npm:pi-web-access`.

Example consuming package entry:

```json
"packages": [
  "npm:pi-web-access",
  "git:github.com/Meynex/pi-extensions@<reviewed-tag-or-commit>"
]
```

Do not use an unpinned moving branch for production if reproducibility is required.
