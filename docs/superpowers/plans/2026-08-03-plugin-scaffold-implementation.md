# herdr-summary-header Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct-Anthropic-API summarizer with an agent-CLI-dispatching one (Claude Code, Codex, Antigravity), add unit tests for its pure logic, and scaffold lint/format/CI/release-please tooling so the repo is ready to push to GitHub.

**Architecture:** `summarize.js` stays a single CommonJS script (matches Herdr's plugin invocation model: `node summarize.js`). Pure helper functions are exported via `module.exports` for testing; `main()` runs only when the file is executed directly (`require.main === module`). An `AGENT_ADAPTERS` table maps a normalized agent id to a `{ command, args(prompt) }` pair, dispatched via `execFileSync`. Dev tooling (ESLint flat config, Prettier, `node --test`) and release tooling (release-please against `herdr-plugin.toml`'s version field) are added as sibling config files, wired into two GitHub Actions workflows.

**Tech Stack:** Node.js (built-ins only for runtime: `fs`, `path`, `crypto`, `child_process`), `node:test` + `node:assert` for tests, ESLint 9 (flat config) + Prettier for lint/format, release-please for versioning, GitHub Actions for CI.

## Global Constraints

- No runtime npm dependencies — `summarize.js` uses only Node built-ins (per spec's "Dev tooling" section: devDependencies only, no runtime deps).
- CommonJS throughout (`require`/`module.exports`), no build step (per spec's "Dev tooling" section).
- No API keys or credential config in v1 — the plugin must not read `ANTHROPIC_API_KEY` or call `api.anthropic.com` (per spec's "Model source" section).
- v1 agent adapters: Claude Code, Codex, Antigravity only. Any other/missing/unrecognized agent id is a silent no-op — no title written, no error (per spec's "Model source" section).
- Version is tracked in `herdr-plugin.toml`'s `version` field via release-please's `simple` release type, not in `package.json` (per spec's "Versioning / release workflow" section).
- Conventional Commits (`feat:`, `fix:`, `chore:`, etc.) are required on every commit from this plan onward, since release-please parses them to decide version bumps (per spec's "Versioning / release workflow" section).

---

### Task 1: Refactor `summarize.js` to dispatch through agent-CLI adapters

**Files:**
- Modify: `summarize.js` (entire file — replaces `callAnthropic` and the API-key config path in `main()`)

**Interfaces:**
- Produces (for Task 2's tests and Task 6's manual verification):
  - `truncate(text: string, max: number): string` — unchanged from current implementation.
  - `loadEnvFile(dir: string | undefined): Record<string, string>` — unchanged from current implementation.
  - `stateKeyFor(stateDir: string | undefined, paneId: string): string | null` — unchanged from current implementation.
  - `getAgentId(event: object): string | null` — normalizes whichever field Herdr uses to identify the agent (checks `event.agent`, `event.agent_id`, `event.agent_type` in that order) to a lowercase, hyphenated id (e.g. `"Claude Code"` → `"claude-code"`). Returns `null` if none of those fields are present.
  - `buildPrompt(label: string, sourceText: string): string` — builds the summarization prompt text embedding the diff/output.
  - `stripCliChrome(text: string): string` — strips ANSI escape codes and surrounding whitespace from raw CLI stdout.
  - `AGENT_ADAPTERS: Record<string, { command: string, args: (prompt: string) => string[] }>` — the adapter table, keyed by the same ids `getAgentId` produces.
  - `summarizeWithAgent(agentId: string, prompt: string): string | null` — looks up the adapter, runs it via `execFileSync`, returns cleaned stdout or `null` on any failure (unknown agent id, CLI not installed, non-zero exit).

- [ ] **Step 1: Replace the Anthropic-calling section of `summarize.js` with the agent-adapter dispatch**

Replace the `callAnthropic` function (current lines 76-132) and the `DEFAULT_MODEL` constant (line 12) with:

```js
const AGENT_ADAPTERS = {
  'claude-code': {
    command: 'claude',
    args: (prompt) => ['-p', prompt, '--model', 'haiku'],
  },
  codex: {
    command: 'codex',
    args: (prompt) => ['exec', '--model', 'o4-mini', prompt],
  },
  antigravity: {
    command: 'antigravity',
    args: (prompt) => ['run', '--non-interactive', '--model', 'fast', prompt],
  },
};

function getAgentId(event) {
  const raw = event.agent || event.agent_id || event.agent_type;
  if (!raw || typeof raw !== 'string') return null;
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

function buildPrompt(label, sourceText) {
  return (
    'Summarize what changed in this coding agent session in 1-2 short ' +
    'plain-language sentences. Describe what changed, not how. No ' +
    'markdown, no preamble, no quotes around the summary.\n\n' +
    `${label}:\n\n${sourceText}`
  );
}

function stripCliChrome(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '').trim();
}

function summarizeWithAgent(agentId, prompt) {
  const adapter = AGENT_ADAPTERS[agentId];
  if (!adapter) return null;
  try {
    const output = execFileSync(adapter.command, adapter.args(prompt), {
      encoding: 'utf8',
    });
    const cleaned = stripCliChrome(output);
    return cleaned || null;
  } catch (err) {
    return null;
  }
}
```

Then update `main()` (current lines 168-226) to drop the API-key config block and call the new dispatch instead. Replace this section:

```js
  const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  const config = { ...loadEnvFile(configDir), ...process.env };
  const apiKey = config.ANTHROPIC_API_KEY;
  const model = config.HERDR_SUMMARY_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    return;
  }

  const label = source === 'diff' ? 'Git diff' : 'Recent terminal output';
  const summary = await callAnthropic(apiKey, model, `${label}:\n\n${sourceText}`);

  writeTitle(paneId, summary);
  writeLastHash(stateFile, hash);
```

with:

```js
  const agentId = getAgentId(event);
  if (!agentId) {
    return;
  }

  const label = source === 'diff' ? 'Git diff' : 'Recent terminal output';
  const prompt = buildPrompt(label, sourceText);
  const summary = summarizeWithAgent(agentId, prompt);
  if (!summary) {
    return;
  }

  writeTitle(paneId, summary);
  writeLastHash(stateFile, hash);
```

Since `summarizeWithAgent` is now synchronous, `main` no longer needs to be `async`, but leave it `async` and the outer `main().catch(...)` call as-is — it's harmless and avoids touching unrelated lines. Also remove the now-unused `const https = require('https');` import (line 7), since nothing calls it anymore.

Finally, add exports at the end of the file (before the `main().catch(...)` call), and guard the `main()` invocation so `require`-ing this file for tests doesn't execute it:

```js
module.exports = {
  truncate,
  loadEnvFile,
  stateKeyFor,
  getAgentId,
  buildPrompt,
  stripCliChrome,
  AGENT_ADAPTERS,
  summarizeWithAgent,
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`summary-header: ${err.stack || err.message}\n`);
    process.exit(0);
  });
}
```

Remove the old unguarded `main().catch(...)` call at the bottom of the file (it's replaced by the guarded version above).

- [ ] **Step 2: Sanity-check the file has no leftover references to the removed API-key path**

Run: `grep -n "ANTHROPIC_API_KEY\|callAnthropic\|DEFAULT_MODEL\|https.request\|require('https')" summarize.js`
Expected: no output (empty match).

- [ ] **Step 3: Commit**

```bash
git add summarize.js
git commit -m "feat: dispatch summarization through agent CLI adapters instead of Anthropic API"
```

---

### Task 2: Unit tests for `summarize.js`'s pure logic

**Files:**
- Create: `summarize.test.js`

**Interfaces:**
- Consumes: everything Task 1 exports from `summarize.js` — `truncate`, `loadEnvFile`, `stateKeyFor`, `getAgentId`, `buildPrompt`, `stripCliChrome`, `AGENT_ADAPTERS`.

- [ ] **Step 1: Write the test file**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  truncate,
  loadEnvFile,
  stateKeyFor,
  getAgentId,
  buildPrompt,
  stripCliChrome,
  AGENT_ADAPTERS,
} = require('./summarize.js');

test('truncate leaves short text untouched', () => {
  assert.equal(truncate('hello', 10), 'hello');
});

test('truncate cuts long text and appends a marker', () => {
  const result = truncate('0123456789', 5);
  assert.equal(result, '01234\n...[truncated]');
});

test('truncate treats text at exactly the limit as untouched', () => {
  assert.equal(truncate('12345', 5), '12345');
});

test('loadEnvFile returns {} when dir is undefined', () => {
  assert.deepEqual(loadEnvFile(undefined), {});
});

test('loadEnvFile returns {} when .env does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summarize-test-'));
  assert.deepEqual(loadEnvFile(dir), {});
});

test('loadEnvFile parses quoted values, comments, and blank lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summarize-test-'));
  fs.writeFileSync(
    path.join(dir, '.env'),
    ['# a comment', '', 'FOO=bar', 'BAZ="quoted value"', "QUX='single quoted'"].join(
      '\n'
    )
  );
  assert.deepEqual(loadEnvFile(dir), {
    FOO: 'bar',
    BAZ: 'quoted value',
    QUX: 'single quoted',
  });
});

test('stateKeyFor returns null when stateDir is undefined', () => {
  assert.equal(stateKeyFor(undefined, 'pane-1'), null);
});

test('stateKeyFor builds a path keyed by paneId', () => {
  assert.equal(
    stateKeyFor('/tmp/state', 'pane-1'),
    path.join('/tmp/state', 'pane-1.last-hash')
  );
});

test('getAgentId reads event.agent and normalizes it', () => {
  assert.equal(getAgentId({ agent: 'Claude Code' }), 'claude-code');
});

test('getAgentId falls back to event.agent_id then event.agent_type', () => {
  assert.equal(getAgentId({ agent_id: 'Codex' }), 'codex');
  assert.equal(getAgentId({ agent_type: 'Antigravity' }), 'antigravity');
});

test('getAgentId returns null when no agent field is present', () => {
  assert.equal(getAgentId({}), null);
});

test('buildPrompt embeds the label and source text', () => {
  const prompt = buildPrompt('Git diff', 'diff --git a b');
  assert.match(prompt, /Git diff:/);
  assert.match(prompt, /diff --git a b/);
});

test('stripCliChrome removes ANSI escape codes and trims whitespace', () => {
  assert.equal(stripCliChrome('\x1b[32m  hello world  \x1b[0m\n'), 'hello world');
});

test('AGENT_ADAPTERS covers claude-code, codex, and antigravity', () => {
  assert.deepEqual(Object.keys(AGENT_ADAPTERS).sort(), [
    'antigravity',
    'claude-code',
    'codex',
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail before Task 1's export changes are visible (sanity check the harness works)**

Run: `node --test`
Expected: if Task 1 is already done, all tests PASS. If running this step before Task 1, it FAILS with `TypeError: ... is not a function` because `summarize.js` doesn't export these yet — either order is fine as long as the failure/pass reason matches.

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `node --test`
Expected: all tests pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add summarize.test.js
git commit -m "test: cover summarize.js pure logic with node:test"
```

---

### Task 3: `package.json`, ESLint, and Prettier

**Files:**
- Create: `package.json`
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`

**Interfaces:**
- Produces: `npm run lint`, `npm run format`, `npm run format:check`, `npm test` — consumed by Task 4's CI workflow.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "herdr-llm-summary-header",
  "version": "0.1.0",
  "private": true,
  "description": "Herdr plugin that writes an LLM-generated one-line summary to a pane's title when an agent finishes",
  "main": "summarize.js",
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "node --test"
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "eslint": "^9.17.0",
    "prettier": "^3.4.2"
  }
}
```

- [ ] **Step 2: Write `eslint.config.js`**

```js
'use strict';

const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    ignores: ['node_modules/**'],
  },
];
```

- [ ] **Step 3: Write `.prettierrc`**

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 90,
  "trailingComma": "es5"
}
```

- [ ] **Step 4: Write `.prettierignore`**

```
node_modules/
docs/
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` created, no errors.

- [ ] **Step 6: Run lint and format-check, fix any issues they surface**

Run: `npm run lint && npm run format:check`
Expected: if `summarize.js` or `summarize.test.js` don't match Prettier's style, run `npm run format` to auto-fix, then re-run `npm run lint && npm run format:check` until both pass clean.

- [ ] **Step 7: Update `.gitignore` to cover `node_modules/`**

Confirm `node_modules/` is already present (it was added in the original scaffold's `.gitignore`); if not, add it.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json eslint.config.js .prettierrc .prettierignore .gitignore
git commit -m "chore: add ESLint, Prettier, and npm scripts"
```

---

### Task 4: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run lint`, `npm run format:check`, `npm test` from Task 3.

- [ ] **Step 1: Write the workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm test
```

- [ ] **Step 2: Validate the YAML parses**

Run: `node -e "require('yaml') ? null : null" 2>/dev/null; python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/ci.yml'))" 2>/dev/null || node -e "const fs=require('fs'); fs.readFileSync('.github/workflows/ci.yml','utf8')"`
Expected: no error thrown. (This just confirms the file is readable/well-formed; full validation happens once it runs on GitHub in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, format check, and tests on push and pull request"
```

---

### Task 5: release-please config and workflow

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Create: `.github/workflows/release-please.yml`

**Interfaces:**
- Produces: on merge to `main`, a release PR that bumps `herdr-plugin.toml`'s `version` field and `CHANGELOG.md`; merging that PR tags a GitHub Release.

- [ ] **Step 1: Write `release-please-config.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "simple",
  "packages": {
    ".": {
      "extra-files": [
        {
          "type": "toml",
          "path": "herdr-plugin.toml",
          "jsonpath": "$.version"
        }
      ]
    }
  }
}
```

- [ ] **Step 2: Write `.release-please-manifest.json`**

```json
{
  ".": "0.1.0"
}
```

- [ ] **Step 3: Write `.github/workflows/release-please.yml`**

```yaml
name: release-please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
```

- [ ] **Step 4: Confirm `herdr-plugin.toml`'s version line matches the manifest**

Run: `grep '^version' herdr-plugin.toml`
Expected: `version = "0.1.0"` — matches `.release-please-manifest.json`. If it doesn't match, edit `herdr-plugin.toml` so it does (release-please's manifest is the source of truth it diffs against).

- [ ] **Step 5: Commit**

```bash
git add release-please-config.json .release-please-manifest.json .github/workflows/release-please.yml
git commit -m "ci: add release-please for automated versioning of herdr-plugin.toml"
```

---

### Task 6: Update README for the agent-CLI model and verify agent adapters

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `AGENT_ADAPTERS` keys from Task 1 (`claude-code`, `codex`, `antigravity`) to document which CLIs must be installed.

- [ ] **Step 1: Replace the "Setup" section's API-key instructions**

Replace the current "Setup" section (the three numbered steps ending in the `.env` example with `ANTHROPIC_API_KEY`) with:

```markdown
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
```

- [ ] **Step 2: Replace the "How it works" section's config/API description**

Update the bullet that currently says `Calls the Anthropic API directly ... and writes the result` to:

```markdown
- Identifies which agent produced the pane (from the event JSON) and shells
  out to that agent's own CLI in headless mode, using its cheapest/fastest
  model, to generate the summary. Supported in v1: Claude Code, Codex, and
  Antigravity — any other/unrecognized agent is a silent no-op. Writes the
  result with `herdr pane report-metadata <pane_id> --title "<summary>"`.
```

- [ ] **Step 3: Add a "Development" section documenting lint/format/test scripts**

Append before "## Publishing":

```markdown
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
Herdr instance and a real agent CLI.
```

- [ ] **Step 4: Verify the agent adapter commands against whichever CLIs are installed locally**

Run, for each CLI you have installed: `claude --help`, `codex exec --help`, `antigravity --help` (or `antigravity run --help`).

Compare their actual flags against `AGENT_ADAPTERS` in `summarize.js` (`-p ... --model haiku` for `claude`; `exec --model o4-mini ...` for `codex`; `run --non-interactive --model fast ...` for `antigravity`). If any flag doesn't exist or is named differently, edit `AGENT_ADAPTERS` in `summarize.js` to match, then re-run `npm test` and `npm run lint` to confirm nothing broke. If a CLI isn't installed locally, leave its adapter as-is and note in the README's "Development" section (append one sentence) that it hasn't been verified against the real CLI yet.

- [ ] **Step 5: Commit**

```bash
git add README.md summarize.js
git commit -m "docs: document agent-CLI setup and development workflow"
```

(If Step 4 didn't require changing `summarize.js`, drop it from the `git add`.)

---

### Task 7: Create the GitHub repo and push

**Files:** none (operational step, no file changes beyond what's already committed)

**Interfaces:** none

- [ ] **Step 1: Confirm everything is committed**

Run: `git status`
Expected: `nothing to commit, working tree clean`. If not, stop and resolve before proceeding — do not create the remote with uncommitted work outstanding.

- [ ] **Step 2: Create the GitHub repository**

Run: `gh repo create herdr-llm-summary-header --public --source=. --remote=origin --description "Herdr plugin: LLM one-line summary written to the pane title when an agent finishes"`
Expected: repo created on GitHub, `origin` remote added locally.

- [ ] **Step 3: Add the `herdr-plugin` topic**

Run: `gh repo edit --add-topic herdr-plugin`
Expected: command succeeds (no output or a confirmation line).

- [ ] **Step 4: Push**

Run: `git push -u origin main`
Expected: push succeeds; `git log` on GitHub matches local history.

- [ ] **Step 5: Confirm CI runs**

Run: `gh run list --limit 1`
Expected: a `CI` workflow run triggered by the push, eventually showing `completed`/`success`. If it fails, read the log (`gh run view --log-failed`), fix the underlying issue locally, commit, and push again — don't disable the check.

---

## Self-Review Notes

- **Spec coverage:** repo structure (Task 3-5 files match spec's tree), release-please/versioning (Task 5), lint+format+test tooling (Task 3-4), model-source change to agent CLIs (Task 1-2), README updates (Task 6), GitHub repo + topic (Task 7). All spec sections have a corresponding task.
- **No placeholders:** agent adapter commands for Codex/Antigravity are concrete (not "TBD" left in code) — Task 6 Step 4 is the explicit verification/correction pass the spec called for, with a real fallback (note in README) if a CLI isn't available to test against.
- **Type/name consistency:** `getAgentId`, `buildPrompt`, `stripCliChrome`, `summarizeWithAgent`, `AGENT_ADAPTERS` are named identically across Task 1 (produces) and Task 2/6 (consumes).
