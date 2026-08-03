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
