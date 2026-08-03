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
    ['# a comment', '', 'FOO=bar', 'BAZ="quoted value"', "QUX='single quoted'"].join('\n')
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
