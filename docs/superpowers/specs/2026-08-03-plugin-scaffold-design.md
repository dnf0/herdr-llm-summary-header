# herdr-summary-header: plugin scaffold, versioning, and tooling

## Goal

Turn the existing plugin logic (manifest + event script) into a properly
scaffolded, versioned, and tested repo, ready to push to GitHub and be
installed via `herdr plugin install`.

This spec covers repo structure, release/versioning tooling, and dev tooling
(lint/format/test). It does not change the plugin's runtime behavior
(described in the original PLAN.md): fire on `pane.agent_status_changed`,
gate on `status == "done"`, summarize git diff (or fallback to recent pane
output) via a small Claude model, write the result as the pane title, and
cache by content hash to skip redundant calls.

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
  report-metadata`, the Anthropic HTTP call) are explicitly out of scope for
  automated tests here — they're exercised manually via `herdr plugin link`
  against a real Herdr instance, and this is called out in the README so
  it's not mistaken for full coverage.

## Out of scope

- Any change to the plugin's runtime summarization behavior itself (already
  implemented in `summarize.js` per PLAN.md).
- npm registry publishing.
- Multi-agent support beyond what PLAN.md already scoped (Claude Code
  first).
