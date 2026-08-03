FROM node:20-slim

# CLI versions are deliberately unpinned — the point of this smoke test is to
# catch upstream flag renames/breakage against the latest published CLIs.
RUN npm install -g @anthropic-ai/claude-code @openai/codex

WORKDIR /app
COPY summarize.js ./
COPY smoke/run-adapters.js ./smoke/
COPY smoke/entrypoint.sh ./smoke/
COPY test/smoke/shape-check.js ./test/smoke/
RUN chmod +x ./smoke/entrypoint.sh

ENTRYPOINT ["./smoke/entrypoint.sh"]
CMD ["node", "smoke/run-adapters.js"]
