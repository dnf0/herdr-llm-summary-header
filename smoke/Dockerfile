FROM node:20-slim

# CLI version is deliberately unpinned — the point of this smoke test is to
# catch upstream flag renames/breakage against the latest published CLI.
# codex isn't installed here — see the comment in run-adapters.js for why
# it's excluded from this smoke test.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY summarize.js ./
COPY smoke/run-adapters.js ./smoke/
COPY test/smoke/shape-check.js ./test/smoke/

CMD ["node", "smoke/run-adapters.js"]
