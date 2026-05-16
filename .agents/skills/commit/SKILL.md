---
name: commit
description: 'Create well-structured git commits following Conventional Commits. Use when the user asks to commit, create commits, stage and commit, fix commit messages, or says "commit", "提交", "msg".'
argument-hint: 'Optional: specific files or message hint'
---

# Commit Workflow

Create git commits following Conventional Commits for a single-file Tampermonkey userscript project. All commit titles and body text must be in **English**.

---

## Phase 1 — Collect Context

Run simultaneously:

```
git status --short
git log --format='%H %s' origin/main..HEAD
```

If no changes and no local-ahead commits, report and stop.

---

## Phase 2 — Categorize Changes

Map changed files to a commit type:

| File pattern | Type | Example |
|---|---|---|
| `src/**/*.ts` | `feat` / `fix` / `refactor` / `perf` | depends on change nature |
| `auto-approve-deploy*.user.js` | (build output — do not commit) | — |
| `README.md`, `README.zh-CN.md` | `docs` | |
| `.github/copilot-instructions.md` | `docs` | |
| `.agents/**` | `chore` | |
| `.github/workflows/**` | `ci` | |
| `vite.config.ts`, `tsconfig.json`, `package.json`, `.release-it.json` | `chore` / `build` | |

Valid types: `feat`, `fix`, `docs`, `refactor`, `perf`, `chore`, `style`, `ci`, `build`

Modular `src/` project — most changes will be a single commit. Only split when changes are logically independent (e.g., a bug fix + unrelated docs update).

---

## Phase 3 — Sync Docs Check (REQUIRED for `src/**` changes)

Before committing **any change under `src/`**, verify whether project documentation needs an accompanying update. Skip this phase only for pure `docs`/`chore`/`ci` commits.

### 3a. Inspect what changed

```
git diff --stat origin/main..HEAD -- src/
git diff origin/main..HEAD -- src/
```

### 3b. Check each doc file against the changes

For every doc below, decide if it is **STALE** (needs update) or **OK** (still accurate):

1. **`.github/copilot-instructions.md`** — STALE if any of the following changed:
   - Architecture / directory layout (`src/` tree)
   - Conventions (e.g., new persistence keys, new event types, naming rules)
   - Security model (token storage, escaping, CSRF handling)
   - Core flows (`start()` vs `resume()`, page refresh behavior, watchdog, multi-tab)
   - GM_* APIs used (need new grant → must reflect in this file)

2. **`README.md`** (English) — STALE if user-visible behavior changed:
   - New buttons / controls in the panel
   - New features (notifications, pause, overview widget, watchdog, etc.)
   - Install / update instructions changed
   - Screenshots out of date
   - Permissions / grants changed

3. **`README.zh-CN.md`** — Mirrors `README.md`; must update together.

### 3c. Decision matrix

| Doc state | Action |
|---|---|
| All docs OK | Proceed to Phase 4 with just the code commit |
| Doc(s) STALE but tiny tweak (≤ a few lines) | Bundle into the same commit (note in body) |
| Doc(s) STALE and substantive | Either: (a) ask user "update docs first?" — recommended; or (b) commit code now and emit a follow-up `docs:` commit with the doc updates |

**Default behavior:** If docs are stale, ask the user **once** whether to update docs in the same PR/commit cycle. Do not silently skip.

### 3d. Report

In the commit plan presented in Phase 4, include a line like:
- `Docs check: ✅ all up to date` — OR —
- `Docs check: ⚠ README.md needs update (new pause button) — bundling into commit` — OR —
- `Docs check: ⚠ copilot-instructions.md needs update — follow-up docs commit planned`

---

## Phase 4 — Draft & Confirm

### Commit message format

```
type: short summary in lowercase

- What changed and why (bullet list)
- Focus on behavior, not file names
```

**Title rules:**
- `type: description` — English, lowercase start, no period, imperative mood, ≤72 chars
- No scope required

**Body:** English, bullet list, wrap at 72 chars. Optional for trivial changes.

### Present plan to user

Show the planned commit(s), the docs-check result from Phase 3, and ask for confirmation once.

---

## Phase 5 — Execute

```
git add <files>
git commit -m "<title>" -m "<body>"
```

After committing, run `git log --oneline origin/main..HEAD` and report the result.

---

## Edge Cases

- **Mixed changes** (e.g., feature + docs): Prefer one commit if they're related. Split only if truly independent.
- **Amend last commit**: Use `git commit --amend` when the user asks to fix the previous commit.
- **TypeScript build**: Run `npm run build` to verify the project compiles before committing significant `src/` changes. Do **not** commit the generated `auto-approve-deploy*.user.js` files — they are gitignored / built in CI.
- **Docs out of date but user declines update**: Proceed with code commit, but record a TODO note in the commit body so it's not forgotten.
