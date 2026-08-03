# herdr-summary-header: plugin scaffold, versioning, and tooling

## Goal

Turn the existing plugin logic (manifest + event script) into a properly
scaffolded, versioned, and tested repo, ready to push to GitHub and be
installed via `herdr plugin install`.

This spec covers repo structure, release/versioning tooling, dev tooling
(lint/format/test), and one runtime change from the original PLAN.md: instead
of calling the Anthropic API directly with an owned API key, the plugin
shells out to the CLI already running in the pane (in v1, Claude Code) so it
rides the user's existing session/subscription rather than requiring a
separate key. Everything else from PLAN.md is unchanged: fire on
`pane.agent_status_changed`, gate on `status == "done"`, summarize git diff
(or fallback to recent pane output), write the result as the pane title, and
cache by content hash to skip redundant calls.

## Model source

- Instead of `https.request` to `api.anthropic.com` with an owned
  `ANTHROPIC_API_KEY`, the plugin shells out (`execFileSync`) to the CLI
  already running in the pane, in headless/non-interactive mode, using that
  tool's cheapest/fastest model. This removes the need for any credential
  config in v1.
- v1 supports **Claude Code, Codex, and Antigravity**, dispatched by a small
  adapter table keyed on the event JSON's `agent` field (exact field
  name/values TBD — first implementation step is to inspect a real
  `pane.agent_status_changed` payload to confirm them). Each adapter is just
  a command template + cheap-model flag:
  - Claude Code: `claude -p "<prompt>" --model haiku`
  - Codex: `codex exec "<prompt>"` with its low-cost model flag (exact flag
    TBD — confirm against `codex exec --help` during implementation; Codex
    CLI naming/flags may have changed since training cutoff)
  - Antigravity: command and cheap-model flag TBD — confirm against that
    CLI's own `--help`/docs during implementation, since it's newer and
    less documented in training data
  In all cases the diff/output context is embedded in `<prompt>`, stdout is
  captured, and a light cleanup strips CLI chrome (ANSI codes, leading/
  trailing whitespace) before using it as the title.
- Any other, missing, or unrecognized `agent` value causes the plugin to
  exit silently without writing a title — same "no context available"
  no-op path as when there's no diff/output to summarize. This leaves room
  to add more adapters later behind the same dispatch point without
  redesigning it.
- `HERDR_PLUGIN_CONFIG_DIR`/`.env` is no longer required for API
  credentials in v1. It's left available for future tunables (e.g. max
  summary length) but nothing reads it yet.

## Repo structure

```
herdr-llm-summary-header/
  herdr-plugin.toml
  summarize.js
  summarize.test.js
  package.json
  eslint.config.js
  .prettierrc
  release-please-config.json
  .release-please-manifest.json
  .github/workflows/
    ci.yml
    release-please.yml
  README.md
  .gitignore
  docs/superpowers/specs/   # this spec
```

## Versioning / release workflow

- Tool: [release-please](https://github.com/googleapis/release-please),
  driven by Conventional Commits (`feat:`, `fix:`, `chore:`, `feat!:` /
  `BREAKING CHANGE:` footer for majors).
- `release-please-config.json` declares a single package at repo root with
  `"release-type": "simple"` (no npm publish) and an `extra-files` entry
  targeting `herdr-plugin.toml`'s `version = "..."` line, so release-please
  edits that field directly instead of a `package.json` version field.
- `.release-please-manifest.json` tracks current version, seeded at
  `{".": "0.1.0"}`.
- `.github/workflows/release-please.yml` runs
  `googleapis/release-please-action` on push to `main`. It maintains a
  standing "Release PR" that accumulates a version bump + `CHANGELOG.md`
  entry as commits land. Merging that PR bumps `herdr-plugin.toml`, updates
  the changelog, and creates a GitHub Release + git tag (`vX.Y.Z`).
- No npm registry publish step. The tag/release plus the `herdr-plugin`
  GitHub topic (per PLAN.md) is what makes the plugin discoverable via
  `herdr plugin install`.

## Dev tooling

- `package.json`: CommonJS (matches `summarize.js`'s existing `require`
  usage, no build step needed). Scripts:
  - `lint`: `eslint .`
  - `format`: `prettier --write .`
  - `format:check`: `prettier --check .`
  - `test`: `node --test`
  devDependencies: `eslint`, `prettier`. No runtime dependencies (the
  Anthropic call uses Node's built-in `https`).
- ESLint: flat config (`eslint.config.js`), recommended ruleset only — catch
  real bugs (unused vars, undefined refs), not style (style is Prettier's
  job).
- Prettier: default-ish config, single `.prettierrc` with just the project's
  preferred `singleQuote`/`semi` choices matching the existing code style.
- `.github/workflows/ci.yml`: on push and pull_request, `npm ci`, then
  `npm run lint`, `npm run format:check`, `npm test`.

## Testing approach

`summarize.js` currently mixes pure logic (truncation, env-file parsing,
cache key/hash handling) with side-effecting calls (`execFileSync` for git
and the `herdr` binary, `https.request` for the Anthropic API). To make the
pure logic testable without mocking child processes or network calls:

- Export the pure helper functions (`truncate`, `loadEnvFile`,
  `stateKeyFor`, hash computation) via `module.exports` alongside the
  existing `main()` entry point invocation guarded by
  `require.main === module`.
- `summarize.test.js` uses Node's built-in `node:test` + `node:assert` (no
  new dependency) to cover: truncation boundary behavior, `.env` file
  parsing (quotes, comments, blank lines), and cache-hash stability/change
  detection.
- Side-effecting paths (git diff, `herdr agent read`, `herdr pane
  report-metadata`, and the `claude -p` CLI invocation) are explicitly out
  of scope for automated tests here — they're exercised manually via
  `herdr plugin link` against a real Herdr instance, and this is called out
  in the README so it's not mistaken for full coverage.

## Out of scope

- npm registry publishing.
- Adapters for agents beyond Claude Code, Codex, and Antigravity (can be
  added later behind the same dispatch point).
- Confirming exact CLI flags for Codex/Antigravity headless invocation and
  the exact event JSON `agent` field name/values — these are implementation-
  time verification steps, not design decisions, since the docs weren't
  checked as part of this spec.
