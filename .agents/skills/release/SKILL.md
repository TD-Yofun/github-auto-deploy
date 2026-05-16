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

## Phase 2 — Choose Version Bump (USER DECIDES)

**The agent never picks the version unilaterally.** Always ask the user, even if the argument-hint was supplied — re-confirm before proceeding.

Inspect commits since the last tag to give the user context:

```
git describe --tags --abbrev=0
git log --format='%h %s' $(git describe --tags --abbrev=0)..HEAD
```

Present to the user:

1. Current version (from `package.json`)
2. The commit list above
3. A reference table (not a decision) so the user can choose:

| Convention | Typical bump |
|---|---|
| `feat!:` / `BREAKING CHANGE` | `major` |
| `feat:` | `minor` |
| `fix:` / `perf:` / `refactor:` / `docs:` / `chore:` | `patch` |

Then ask the user explicitly: **"Which bump do you want — `patch`, `minor`, `major`, or an exact `x.y.z`?"** Wait for an answer. Do not assume.

Note: `refactor!:` indicates a breaking change but no new feature; whether to release as `minor` or `major` is a judgement call — surface this to the user, do not decide for them.

---

## Phase 3 — Dry Run (REQUIRED, then confirm)

Always run a dry-run first to preview what release-it will do:

```
npm run release:dry -- <bump>
```

Where `<bump>` is the value the user chose in Phase 2.

Show the full output to the user, then **stop and explicitly ask: "Proceed with the real release?"** Wait for `yes` (or equivalent). Do not proceed on silence or ambiguity.

---

## Phase 4 — Execute Release (only after user confirms)

```
npm run release -- <bump>
```

What release-it does automatically (per `.release-it.json`):

1. Bump `version` in `package.json`
2. Run `after:bump` hook → `npm run build` (rebuilds both `.user.js` artifacts with new `@version`)
3. Generate/update `CHANGELOG.md` from conventional commits
4. Commit `chore: release v<x.y.z>`
5. Create annotated tag `v<x.y.z>`
6. **Push commit + tag to `origin/main`** ← non-reversible; this is why Phase 3 confirmation is required
7. Create GitHub Release `v<x.y.z>` with both `.user.js` files attached

Use `--ci` to skip interactive prompts only when the user has already chosen the version and confirmed the dry-run.

### Behind an HTTP proxy (octokit cannot reach api.github.com)

release-it's octokit ignores lowercase `http_proxy` and `--github.proxy` is broken in recent versions. Fallback (still confirm with user before running):

```
npm run release -- <bump> --ci --github.skipChecks
# release-it bumps/builds/commits/tags/pushes; the GitHub Release step is skipped
gh release create v<x.y.z> \
  --title v<x.y.z> \
  --notes-file <(awk '/^## /{c++; if(c==2) exit} c==1' CHANGELOG.md) \
  auto-approve-deploy.user.js auto-approve-deploy.min.user.js
```

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

## Edge Cases (ALL require explicit user confirmation before acting)

- **No conventional commits since last tag**: release-it still works but the `CHANGELOG.md` section will be empty. Warn the user and ask whether the release is still meaningful — do not proceed silently.
- **Build fails during `after:bump`**: release-it aborts before tagging. Report the failure, fix the build, then ask the user before re-running.
- **Tag already exists**: indicates a previous incomplete release. **Never delete tags automatically.** Show the user the local + remote tag state and ask before running `git tag -d v<x.y.z> && git push --delete origin v<x.y.z>`.
- **First release**: no prior tag exists. release-it will use `package.json` version as the base; ask the user what initial version to publish (do not assume `1.0.0` vs `0.1.0`).
- **Hotfix on non-main branch**: not supported by current config (`requireBranch: main`). Abort and instruct user to merge to main first.
- **Working tree dirty / unpushed commits unrelated to the release**: stop and ask the user how to handle them (commit, stash, or discard) — never stash/discard without confirmation.

## Confirmation Checklist

Before the release lands on GitHub, the user must have explicitly answered:

1. Which version bump (Phase 2)
2. "Proceed with the real release?" after seeing dry-run output (Phase 3)
3. Any edge-case prompt that involves deleting tags, force-pushing, or modifying history

If any of the above was not explicitly confirmed, **stop and ask**.
