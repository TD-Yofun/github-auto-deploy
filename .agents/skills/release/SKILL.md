---
name: release
description: 'Publish a new release using release-it (conventional commits → version bump → build → tag → GitHub Release). Use when the user asks to release, publish, cut a version, or says "release", "发布", "出新版本".'
argument-hint: 'Optional: patch | minor | major | x.y.z'
---

# Release Workflow

Publish a new version of the userscript using `release-it`. The flow bumps `package.json`, rebuilds both `.user.js` artifacts (version is read from `package.json` by `vite.config.ts`), generates `CHANGELOG.md` from conventional commits, creates a git tag, and publishes a GitHub Release with the built userscript files attached.

---

## Phase 1 — Pre-flight Checks

Run simultaneously:

```
git status --short
git rev-parse --abbrev-ref HEAD
git log --format='%s' origin/main..HEAD
gh auth status
```

Requirements (abort with clear message if any fails):

- Working directory **clean** (no uncommitted changes)
- Current branch is **main**
- At least one commit ahead of `origin/main` (otherwise nothing to release)
- `gh` is authenticated (needed for GitHub Release creation)
- `GITHUB_TOKEN` environment variable is set OR `gh auth token` works (release-it reads from one of them)

If `GITHUB_TOKEN` is missing, suggest:
```
export GITHUB_TOKEN=$(gh auth token)
```

---

## Phase 2 — Choose Version Bump

Inspect the commits since the last tag to recommend the bump type:

```
git log --format='%s' $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~10)..HEAD
```

| Commit prefix found | Recommended bump |
|---|---|
| `feat!`, `BREAKING CHANGE` | `major` |
| `feat:` (no breaking) | `minor` |
| only `fix:` / `perf:` / `refactor:` / `docs:` / `chore:` | `patch` |

Present the recommendation and the commit list to the user. Ask once for confirmation (or override with explicit version).

---

## Phase 3 — Dry Run (recommended)

Always run a dry-run first to preview what release-it will do:

```
npm run release:dry -- <bump>
```

Where `<bump>` is `patch` / `minor` / `major` / `x.y.z`.

Show the output to the user. Confirm before proceeding to the real release.

---

## Phase 4 — Execute Release

```
npm run release -- <bump>
```

What release-it does automatically (per `.release-it.json`):

1. Bump `version` in `package.json`
2. Run `after:bump` hook → `npm run build` (rebuilds both `.user.js` artifacts with new `@version`)
3. Generate/update `CHANGELOG.md` from conventional commits
4. Commit `chore: release v<x.y.z>`
5. Create annotated tag `v<x.y.z>`
6. Push commit + tag to `origin/main`
7. Create GitHub Release `v<x.y.z>` with both `.user.js` files attached

Use `--ci` to skip interactive prompts in automated contexts.

---

## Phase 5 — Verify

After release-it completes:

```
gh release view v<x.y.z>
git log --oneline -3
```

Confirm:
- Release page exists with both `auto-approve-deploy.user.js` and `auto-approve-deploy.min.user.js` attached
- Tag pushed to remote
- `CHANGELOG.md` updated and committed
- Built `.user.js` files contain the new `@version` line

Report the release URL to the user.

---

## Edge Cases

- **No conventional commits since last tag**: release-it still works but `CHANGELOG.md` section will be empty. Warn the user; consider whether a release is meaningful.
- **Build fails during `after:bump`**: release-it aborts before tagging. Fix the build, then re-run.
- **Tag already exists**: indicates a previous incomplete release. Ask the user before deleting the tag (`git tag -d v<x.y.z> && git push --delete origin v<x.y.z>`).
- **First release**: no prior tag exists. release-it will pick `1.0.0` from `package.json` as the base; recommend bumping to `1.0.1` (patch) or starting fresh from `0.1.0`.
- **Hotfix on non-main branch**: not supported by current config (`requireBranch: main`). Abort and instruct user to merge to main first.
