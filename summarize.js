#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MAX_DIFF_CHARS = 12000;
const MAX_OUTPUT_CHARS = 8000;

function loadEnvFile(dir) {
  if (!dir) return {};
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, idx).trim()] = value;
  }
  return out;
}

function readJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function getGitDiff(cwd) {
  try {
    const staged = execFileSync('git', ['diff', '--staged'], { cwd, encoding: 'utf8' });
    const unstaged = execFileSync('git', ['diff'], { cwd, encoding: 'utf8' });
    const combined = `${staged}${unstaged}`.trim();
    return combined || null;
  } catch (err) {
    return null;
  }
}

function getRecentOutput(paneId) {
  const herdrBin = process.env.HERDR_BIN_PATH;
  if (!herdrBin || !paneId) return null;
  try {
    return (
      execFileSync(
        herdrBin,
        ['agent', 'read', paneId, '--source', 'recent-unwrapped', '--lines', '150'],
        { encoding: 'utf8' }
      ).trim() || null
    );
  } catch (err) {
    return null;
  }
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated]`;
}

const AGENT_ADAPTERS = {
  'claude-code': {
    command: 'claude',
    args: (prompt) => ['-p', prompt, '--model', 'haiku'],
  },
  codex: {
    command: 'codex',
    args: (prompt) => ['exec', '--skip-git-repo-check', '--model', 'o4-mini', prompt],
  },
  antigravity: {
    command: 'antigravity',
    args: (prompt) => ['run', '--non-interactive', '--model', 'fast', prompt],
  },
};

// Herdr's real pane.agent_status_changed events report the bare detector
// id (e.g. "claude", from agent-detection/remote/claude.toml), not
// "Claude Code" — confirmed via `herdr agent explain` against a live pane.
// `codex` already matches AGENT_ADAPTERS as-is.
const AGENT_ID_ALIASES = {
  claude: 'claude-code',
};

function getAgentId(event) {
  const raw = event.agent || event.agent_id || event.agent_type;
  if (!raw || typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '-');
  return AGENT_ID_ALIASES[normalized] || normalized;
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
      timeout: 60_000,
    });
    const cleaned = stripCliChrome(output);
    return cleaned || null;
  } catch (err) {
    return null;
  }
}

function writeTitle(paneId, title) {
  const herdrBin = process.env.HERDR_BIN_PATH;
  if (!herdrBin) {
    throw new Error('HERDR_BIN_PATH is not set');
  }
  execFileSync(herdrBin, ['pane', 'report-metadata', paneId, '--title', title], {
    encoding: 'utf8',
  });
}

function stateKeyFor(stateDir, paneId) {
  if (!stateDir) return null;
  return path.join(stateDir, `${paneId}.last-hash`);
}

function readLastHash(stateFile) {
  if (!stateFile || !fs.existsSync(stateFile)) return null;
  try {
    return fs.readFileSync(stateFile, 'utf8').trim();
  } catch (err) {
    return null;
  }
}

function writeLastHash(stateFile, hash) {
  if (!stateFile) return;
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, hash);
  } catch (err) {
    // Non-fatal: caching is a best-effort optimization.
  }
}

async function main() {
  const event = readJsonEnv('HERDR_PLUGIN_EVENT_JSON');
  if (!event || event.status !== 'done') {
    return;
  }

  const paneId = event.pane_id || event.paneId;
  if (!paneId) {
    return;
  }

  const context = readJsonEnv('HERDR_PLUGIN_CONTEXT_JSON') || {};
  const cwd = context.cwd || context.working_dir;

  let source = null;
  let sourceText = null;

  if (cwd) {
    const diff = getGitDiff(cwd);
    if (diff) {
      source = 'diff';
      sourceText = truncate(diff, MAX_DIFF_CHARS);
    }
  }

  if (!sourceText) {
    const output = getRecentOutput(paneId);
    if (output) {
      source = 'output';
      sourceText = truncate(output, MAX_OUTPUT_CHARS);
    }
  }

  if (!sourceText) {
    return;
  }

  const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
  const stateFile = stateKeyFor(stateDir, paneId);
  const hash = crypto.createHash('sha256').update(sourceText).digest('hex');
  if (stateFile && readLastHash(stateFile) === hash) {
    return;
  }

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
}

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
