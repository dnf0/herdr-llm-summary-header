FROM node:20-slim

RUN npm install -g @anthropic-ai/claude-code @openai/codex

WORKDIR /app
COPY summarize.js ./
COPY test/smoke/run-adapters.js test/smoke/shape-check.js ./test/smoke/

CMD ["node", "test/smoke/run-adapters.js"]
