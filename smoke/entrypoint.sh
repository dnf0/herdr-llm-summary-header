#!/bin/sh
set -e
[ -f /creds-ro/claude.json ] && cp /creds-ro/claude.json "$HOME/.claude.json"
[ -d /creds-ro/claude ] && cp -r /creds-ro/claude "$HOME/.claude"
[ -d /creds-ro/codex ] && cp -r /creds-ro/codex "$HOME/.codex"
exec "$@"
