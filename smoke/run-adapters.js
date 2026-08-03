#!/usr/bin/env node
'use strict';

const { summarizeWithAgent, buildPrompt } = require('../summarize.js');
const { looksLikeSummary } = require('../test/smoke/shape-check.js');

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
      console.error(`✗ ${agentId}: result was null`);
      allPassed = false;
      continue;
    }

    if (!looksLikeSummary(result)) {
      console.error(`✗ ${agentId}: failed shape check: ${JSON.stringify(result)}`);
      allPassed = false;
      continue;
    }

    console.log(`✓ ${agentId}: ${JSON.stringify(result)}`);
  }

  process.exit(allPassed ? 0 : 1);
}

main();
