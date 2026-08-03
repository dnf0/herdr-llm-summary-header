# herdr-summary-header

A [Herdr](https://github.com/bcihanc/herdr) plugin that generates a short LLM
summary of the work an agent just finished, and displays it as the pane
title.

When an agent pane transitions to `done`, this plugin summarizes the git diff
(or, if there's no diff, recent terminal output) in 1-2 plain-language
sentences using a small/fast Claude model, then writes that summary as the
pane's displayed title. Display-only — it doesn't touch Herdr's own
working/blocked/done detection.

## Setup

1. Install and authenticate whichever agent CLI(s) you use in Herdr panes —
   the plugin shells out to the same CLI already running in the pane, so no
   separate API key is needed:
   - Claude Code: `claude` (from `@anthropic-ai/claude-code`)
   - Codex: `codex`
   - Antigravity: `antigravity`
2. Link the plugin for local development:
   ```
   herdr plugin link /path/to/herdr-llm-summary-header
   ```

## How it works

- Fires on `pane.agent_status_changed`; exits immediately unless the new
  status is `done`.
- Prefers `git diff` (staged + unstaged) in the pane's working directory;
  falls back to recent pane output via `herdr agent read` if there's no diff.
- Skips re-summarizing when the diff/output hash hasn't changed since the
  last run (cached under `HERDR_PLUGIN_STATE_DIR`).
- Identifies which agent produced the pane (from the event JSON) and shells
  out to that agent's own CLI in headless mode, using its cheapest/fastest
  model, to generate the summary. Supported in v1: Claude Code, Codex, and
  Antigravity — any other/unrecognized agent is a silent no-op. Writes the
  result with `herdr pane report-metadata <pane_id> --title "<summary>"`.

## Development

```
npm install
npm run lint
npm run format:check
npm test
```

Automated tests cover `summarize.js`'s pure logic (truncation, `.env`
parsing, cache-key handling, agent-id normalization). The agent-CLI
invocations, git-diff reading, and `herdr` binary calls are side-effecting
and are instead exercised manually via `herdr plugin link` against a real
Herdr instance and a real agent CLI. The `codex` and `antigravity` adapters
in `AGENT_ADAPTERS` have not been verified against their real CLIs yet (the
local `codex` install has a broken native binary and `antigravity` isn't
installed) — only the `claude-code` adapter (`-p <prompt> --model haiku`)
has been confirmed against a real `claude --help`/invocation.

## Smoke-testing agent adapters

The unit tests in `summarize.test.js` cover pure logic only — they don't
call the real `claude`/`codex` CLIs, so an upstream flag rename wouldn't be
caught by `npm test`. `smoke/` has a Docker-based smoke test that
exercises the real `claude-code` and `codex` adapters against real,
already-authenticated CLIs. It's manual and on-demand only — it never runs
in CI, since it needs live credentials and makes real (billable) API calls.
`antigravity` isn't covered (see "Development" above).

Requires you to already be logged into `claude` and `codex` on your host
machine. Your host's `~/.claude.json`, `~/.claude/`, and `~/.codex/` are
bind-mounted read-only into the container at startup, then copied into the
container's own writable, ephemeral filesystem before the CLIs run (since
the CLIs write session state on nearly every invocation) — the host files
themselves are never written back to, and no credentials are stored in the
image or the repo:

```
npm run smoke:build
npm run smoke:run
```

Expected output: one `✓ claude-code: "<summary>"` and one `✓ codex:
"<summary>"` line. A `✗` line means that adapter's CLI invocation is broken
(wrong flags) or its credentials in the mounted directory are stale/missing.

## Publishing

Push to GitHub and add the `herdr-plugin` topic to make it marketplace
discoverable. Others can then install with:

```
herdr plugin install danielfisher/herdr-summary-header
```
