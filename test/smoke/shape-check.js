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
