# Agent-Adapter Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual, Docker-based smoke test that exercises the real `claude-code` and `codex` entries in `summarize.js`'s `AGENT_ADAPTERS` against real, already-authenticated CLIs, so a developer can confirm the adapters still work before relying on them in a real Herdr session.

**Architecture:** A pure `looksLikeSummary(text)` shape-check function (unit-tested with `node:test`, picked up automatically by the existing `npm test`) is consumed by a standalone script (`test/smoke/run-adapters.js`, never run by `npm test` or CI) that calls `summarizeWithAgent` from `summarize.js` for each adapter with a canned diff and reports ✓/✗. A `Dockerfile` installs the `claude` and `codex` CLIs globally; credentials come from read-only bind mounts of the host's existing auth directories at `docker run` time — never baked into the image or stored as secrets.

**Tech Stack:** Node.js built-ins only (no new runtime deps), `node:test` for the shape-check unit test, Docker for the isolated CLI environment.

## Global Constraints

- Never runs in CI — no GitHub Actions integration, no secrets in the repo or CI config (per spec's "Scope" section).
- `antigravity` is out of scope — no known installer, stays documented as unverified in the README, unchanged (per spec's "Scope" section).
- Credentials are supplied only via read-only bind mounts of the host's existing `~/.claude.json`, `~/.claude/`, and `~/.codex/` — never baked into the Docker image, never passed as env-var secrets (per spec's "Components" and "Data Flow" sections).
- CommonJS throughout (`require`/`module.exports`), no build step, no new runtime npm dependencies added to `summarize.js`'s own module graph (per repo's existing Global Constraints, still binding).
- `summarizeWithAgent` already returns `null` on any failure — the smoke test must not add its own try/catch around it; treat `null` as a shape-check failure (per spec's "Error Handling" section).

---

### Task 1: Shape-check heuristic

**Files:**
- Create: `test/smoke/shape-check.js`
- Test: `test/smoke/shape-check.test.js`

**Interfaces:**
- Produces (for Task 2): `looksLikeSummary(text: unknown): boolean` — returns `true` only if `text` is a non-empty (after trim), ANSI-free string of at most 400 characters.

- [ ] **Step 1: Write the failing tests**

Create `test/smoke/shape-check.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { looksLikeSummary } = require('./shape-check.js');

test('looksLikeSummary accepts a normal one-sentence summary', () => {
  assert.equal(
    looksLikeSummary('Refactored the auth adapter to use a shared token cache.'),
    true
  );
});

test('looksLikeSummary rejects null', () => {
  assert.equal(looksLikeSummary(null), false);
});

test('looksLikeSummary rejects a non-string', () => {
  assert.equal(looksLikeSummary(42), false);
});

test('looksLikeSummary rejects an empty string', () => {
  assert.equal(looksLikeSummary(''), false);
});

test('looksLikeSummary rejects a string that is only whitespace', () => {
  assert.equal(looksLikeSummary('   \n\t  '), false);
});

test('looksLikeSummary rejects text longer than 400 characters', () => {
  assert.equal(looksLikeSummary('a'.repeat(401)), false);
});

test('looksLikeSummary accepts text at exactly 400 characters', () => {
  assert.equal(looksLikeSummary('a'.repeat(400)), true);
});

test('looksLikeSummary rejects text containing an ANSI escape sequence', () => {
  assert.equal(looksLikeSummary('\x1b[32mgreen text\x1b[0m'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/smoke/shape-check.test.js`
Expected: FAIL with `Cannot find module './shape-check.js'` (the module doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `test/smoke/shape-check.js`:

```js
'use strict';

function looksLikeSummary(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 400) return false;
  if (/\x1b\[[0-9;]*m/.test(trimmed)) return false;
  return true;
}

module.exports = { looksLikeSummary };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/smoke/shape-check.test.js`
Expected: all 8 tests PASS, 0 failures.

- [ ] **Step 5: Run the full suite to confirm the new test file is picked up automatically**

Run: `npm test`
Expected: the existing `summarize.test.js` tests (14) plus the new `shape-check.test.js` tests (8) all pass — 22 total, 0 failures. This confirms Node's test runner auto-discovers `test/smoke/shape-check.test.js` via its default glob, with no config changes needed.

- [ ] **Step 6: Commit**

```bash
git add test/smoke/shape-check.js test/smoke/shape-check.test.js
git commit -m "test: add shape-check heuristic for agent-adapter smoke test"
```

---

### Task 2: Smoke-test runner script

**Files:**
- Create: `test/smoke/run-adapters.js`

**Interfaces:**
- Consumes: `summarizeWithAgent(agentId, prompt): string | null` and `buildPrompt(label, sourceText): string`, both exported from `../../summarize.js` (repo root). `looksLikeSummary(text): boolean` from `./shape-check.js` (Task 1).
- Produces: a runnable script invoked as `node test/smoke/run-adapters.js`; exits `0` if every tested adapter's result passes the shape check, `1` otherwise. Consumed by Task 3's Dockerfile `CMD` and Task 4's README docs.

- [ ] **Step 1: Write the script**

Create `test/smoke/run-adapters.js`:

```js
#!/usr/bin/env node
'use strict';

const { summarizeWithAgent, buildPrompt } = require('../../summarize.js');
const { looksLikeSummary } = require('./shape-check.js');

const CANNED_DIFF = [
  'diff --git a/src/auth.js b/src/auth.js',
  'index 1234567..89abcde 100644',
  '--- a/src/auth.js',
  '+++ b/src/auth.js',
  '@@ -10,6 +10,9 @@',
  '+function refreshToken(token) {',
  '+  return cache.get(token) || fetchNewToken(token);',
  '+}',
].join('\n');

const ADAPTERS_TO_TEST = ['claude-code', 'codex'];

function main() {
  const prompt = buildPrompt('Git diff', CANNED_DIFF);
  let allPassed = true;

  for (const agentId of ADAPTERS_TO_TEST) {
    const result = summarizeWithAgent(agentId, prompt);

    if (result === null) {
      console.log(`✗ ${agentId}: result was null`);
      allPassed = false;
      continue;
    }

    if (!looksLikeSummary(result)) {
      console.log(`✗ ${agentId}: failed shape check: ${JSON.stringify(result)}`);
      allPassed = false;
      continue;
    }

    console.log(`✓ ${agentId}: ${JSON.stringify(result)}`);
  }

  process.exit(allPassed ? 0 : 1);
}

main();
```

- [ ] **Step 2: Verify the script's syntax is valid**

Run: `node --check test/smoke/run-adapters.js`
Expected: no output, exit code 0 (syntax is valid; this does not execute the script).

- [ ] **Step 3: Verify the script runs to completion without a stack trace, in an environment without the CLIs installed**

Run: `node test/smoke/run-adapters.js`
Expected: since `claude` and `codex` are not installed in this environment (or, if `claude` happens to be installed but unauthenticated in this sandbox, it will fail some other way), the script prints one `✗ claude-code: ...` line and one `✗ codex: ...` line (from `summarizeWithAgent` returning `null` on the `execFileSync` failure) and exits with code 1. The key thing to confirm is there is NO uncaught exception / stack trace — `summarizeWithAgent` already catches all of that internally.

- [ ] **Step 4: Commit**

```bash
git add test/smoke/run-adapters.js
git commit -m "feat: add standalone smoke-test runner for real agent-CLI adapters"
```

---

### Task 3: Dockerfile

**Files:**
- Create: `test/smoke/Dockerfile`

**Interfaces:**
- Consumes: `test/smoke/run-adapters.js` and `test/smoke/shape-check.js` (Tasks 1-2), `summarize.js` (repo root, pre-existing).
- Produces: a buildable image tagged (by the builder, not baked into the file) e.g. `herdr-summary-header-smoke`, whose default `CMD` runs the smoke test. Consumed by Task 4's npm scripts / README docs.

- [ ] **Step 1: Write the Dockerfile**

Create `test/smoke/Dockerfile`:

```dockerfile
FROM node:20-slim

RUN npm install -g @anthropic-ai/claude-code @openai/codex

WORKDIR /app
COPY summarize.js ./
COPY test/smoke/run-adapters.js test/smoke/shape-check.js ./test/smoke/

CMD ["node", "test/smoke/run-adapters.js"]
```

Note: no `npm install`/`npm ci` of the project's own `package.json` is needed here — `summarize.js` and `test/smoke/run-adapters.js` use only Node built-ins at runtime, per the Global Constraints. The only things installed are the two agent CLIs under test.

- [ ] **Step 2: Build the image**

Run (from the repo root, so the build context includes both `summarize.js` and `test/smoke/`):
```bash
docker build -t herdr-summary-header-smoke -f test/smoke/Dockerfile .
```
Expected: image builds successfully with no errors. If `docker` is not available in this environment (e.g. not installed, or daemon not running, or no network access to npm during the sandboxed build), stop and report this as a concern in your final report rather than attempting workarounds — building/verifying the image may need to happen on the human's machine instead.

- [ ] **Step 3: Sanity-check the image runs (without real credentials, expect graceful failure)**

Run:
```bash
docker run --rm herdr-summary-header-smoke
```
Expected: same as Task 2 Step 3 — two `✗` lines (no credentials mounted, so both CLIs fail to authenticate or aren't configured), exit code 1, no crash/stack trace. This confirms the image's `CMD` and file layout are correct; it does NOT prove the CLIs work with real credentials (that's a manual step for the human afterward, requiring their real `~/.claude.json`, `~/.claude/`, `~/.codex/`).

- [ ] **Step 4: Commit**

```bash
git add test/smoke/Dockerfile
git commit -m "build: add Dockerfile for agent-adapter smoke test"
```

(If Docker wasn't available to build/run in this environment, still commit the Dockerfile — it's source, not a build artifact — and note in your report that Steps 2-3 could not be executed here.)

---

### Task 4: npm scripts and README documentation

**Files:**
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: the `herdr-summary-header-smoke` image name and `test/smoke/Dockerfile` path (Task 3), the mounted credential paths (`~/.claude.json`, `~/.claude/`, `~/.codex/`) from the design spec.

- [ ] **Step 1: Add convenience npm scripts**

In `package.json`, add two entries to the existing `"scripts"` object (alongside `lint`, `format`, `format:check`, `test`):

```json
    "smoke:build": "docker build -t herdr-summary-header-smoke -f test/smoke/Dockerfile .",
    "smoke:run": "docker run --rm -v ~/.claude.json:/root/.claude.json:ro -v ~/.claude:/root/.claude:ro -v ~/.codex:/root/.codex:ro herdr-summary-header-smoke"
```

- [ ] **Step 2: Verify `package.json` is still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"`
Expected: no error thrown.

- [ ] **Step 3: Add a README section**

In `README.md`, append a new section right after the existing "Development" section and before "## Publishing":

```markdown
## Smoke-testing agent adapters

The unit tests in `summarize.test.js` cover pure logic only — they don't
call the real `claude`/`codex` CLIs, so an upstream flag rename wouldn't be
caught by `npm test`. `test/smoke/` has a Docker-based smoke test that
exercises the real `claude-code` and `codex` adapters against real,
already-authenticated CLIs. It's manual and on-demand only — it never runs
in CI, since it needs live credentials and makes real (billable) API calls.
`antigravity` isn't covered (see "Development" above).

Requires you to already be logged into `claude` and `codex` on your host
machine (the container reuses your existing `~/.claude.json`, `~/.claude/`,
and `~/.codex/` via read-only mounts — no credentials are stored in the
image or the repo):

```
npm run smoke:build
npm run smoke:run
```

Expected output: one `✓ claude-code: "<summary>"` and one `✓ codex:
"<summary>"` line. A `✗` line means that adapter's CLI invocation is broken
(wrong flags) or its credentials in the mounted directory are stale/missing.
```

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "docs: document the Docker-based agent-adapter smoke test"
```

---

## Self-Review Notes

- **Spec coverage:** Dockerfile + credential mounts (spec's "Components"/"Data Flow") → Task 3; standalone non-CI script with shape-check pass/fail (spec's "Components", "Error Handling") → Tasks 1-2; README docs (spec's "Components") → Task 4; antigravity excluded, no CI wiring, no Herdr e2e (spec's "Scope"/"Non-Goals") → not present anywhere in this plan, correctly.
- **No placeholders:** all file contents are complete and copy-pasteable; Docker/credential steps that may not be runnable in a sandboxed implementer environment have explicit fallback instructions (report as concern, still commit source) rather than "TBD".
- **Type/name consistency:** `looksLikeSummary` (Task 1 produces) is the exact name imported in Task 2. `summarizeWithAgent`/`buildPrompt` names match their existing exports in `summarize.js` (verified against the current file). `herdr-summary-header-smoke` image tag is consistent across Task 3's build/run commands and Task 4's npm scripts.
