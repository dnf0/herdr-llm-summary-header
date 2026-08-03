# Agent-Adapter Smoke Test — Design

## Purpose

`summarize.js`'s `AGENT_ADAPTERS` table encodes the exact CLI invocation
syntax for each supported agent (`claude -p <prompt> --model haiku`, `codex
exec --model o4-mini <prompt>`). The automated unit tests (`summarize.test.js`)
deliberately mock nothing about these commands — they test pure logic only —
so a CLI flag rename upstream would go undetected until a real pane run
failed silently (by design: `summarizeWithAgent` returns `null` on any
failure, so a broken adapter just means "no title update," not an error).

This adds a manual, on-demand smoke test that exercises the real adapters
against real, already-authenticated `claude` and `codex` CLIs inside a
Docker container, so a developer can quickly confirm the adapters still work
before relying on them in a real Herdr session.

## Scope

- **In scope:** `claude-code` and `codex` adapters.
- **Out of scope:** `antigravity` — no known npm/brew installer, not
  installed locally; stays documented as unverified in the README, unchanged
  from the current state.
- **Out of scope:** full Herdr end-to-end testing (linking the plugin,
  simulating a `pane.agent_status_changed` event, asserting
  `report-metadata` gets called). Herdr's server+client model isn't
  trivially scriptable headless; this is deferred to a separate design once
  Herdr's headless story is clearer.
- **Out of scope:** CI integration. This never runs in GitHub Actions — it
  requires real, already-authenticated credentials and makes real (billable)
  LLM calls. Secrets never enter the repo or CI config.

## Components

### `test/smoke/Dockerfile`

Node base image (matching the CI workflow's Node 20). Installs
`@anthropic-ai/claude-code` and `@openai/codex` globally via npm. Does not
bake in any credentials — those are supplied at `docker run` time via
read-only bind mounts of the host's existing auth directories:

- `~/.claude.json` and `~/.claude/` (claude-code)
- `~/.codex/` (codex — contains `auth.json` and `config.toml`)

### `test/smoke/run-adapters.js`

A standalone script — not part of `node --test`, not run by `npm test` or
CI. For each of `claude-code` and `codex`:

1. Calls `summarizeWithAgent(agentId, buildPrompt('Git diff', <canned small
   diff>))`, requiring `../../summarize.js`.
2. Checks the result against a shape heuristic: non-null, non-empty after
   trim, no leftover ANSI escape sequences, and roughly sentence-shaped
   (a soft length bound — e.g. 1–400 characters — to catch obviously broken
   output like a raw JSON error dump or CLI help text, without being a
   strict grammar check).
3. Prints `✓ <agentId>: "<summary>"` on success or `✗ <agentId>: <reason>`
   on failure (null result, or shape-check failure with why).
4. Tracks overall pass/fail; exits `0` if all adapters passed the shape
   check, `1` otherwise.

`antigravity` is not included in the loop — a comment notes it's unverified,
consistent with the README.

### Run script / docs

A `docker build` + `docker run` invocation (documented directly in the
README's new section — no separate compose file needed for two bind mounts)
that:

1. Builds the image from `test/smoke/Dockerfile`.
2. Runs the container with `~/.claude.json`, `~/.claude/`, and `~/.codex/`
   mounted read-only at the same paths inside the container (so the CLIs
   find them via their normal lookup, no env-var redirection needed).
3. Runs `node test/smoke/run-adapters.js`.

### README addition

A new "Smoke-testing agent adapters" section documenting the one-liner(s)
to build and run the container, what it checks, and that it requires you to
already be logged into `claude` and `codex` on your host machine.

## Data Flow

```
host ~/.claude.json, ~/.claude/, ~/.codex/   (already-authenticated, read-only)
        │  bind mount
        ▼
Docker container (node20 + claude CLI + codex CLI)
        │  runs
        ▼
test/smoke/run-adapters.js
        │  require('../../summarize.js')
        ▼
summarizeWithAgent('claude-code', prompt)  →  execFileSync('claude', [...])  →  real API call
summarizeWithAgent('codex', prompt)        →  execFileSync('codex', [...])  →  real API call
        │
        ▼
✓/✗ per adapter, process exit code
```

## Error Handling

`summarizeWithAgent` already swallows every failure mode (unknown agent,
CLI not installed, non-zero exit, thrown error) and returns `null` — the
smoke test doesn't need special-case error handling beyond treating `null`
as a shape-check failure. A stale/missing credential mount, a broken CLI
install, or an upstream flag rename all surface the same way: `✗ <agentId>:
result was null`.

## Testing

This *is* the manual verification layer — there's no automated test of the
smoke test itself. After implementation, run it once against real
credentials to confirm both adapters print a sane one-to-two-sentence
summary.

## Non-Goals

- Does not test the no-diff/output-fallback path, the caching/hash-skip
  logic, or `writeTitle` — those are pure-logic-adjacent and already covered
  by `summarize.test.js`, or require a real Herdr instance (out of scope,
  see above).
- Does not attempt to install or verify `antigravity`.
