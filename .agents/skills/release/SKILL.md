---
name: release
description: 'Publish a new release: local `release-it` bumps/builds/commits/tags, user pushes, GitHub Actions creates the GitHub Release. Use when the user asks to release, publish, cut a version, or says "release", "发布", "出新版本".'
argument-hint: 'Optional: patch | minor | major | x.y.z'
---

# Release Workflow

Releases are split between **local** and **CI**:

| Step | Where | Tool |
|---|---|---|
| Bump `package.json` | local | release-it |
| Build `.user.js` artifacts | local | `npm run build` (release-it `after:bump` hook) |
| Update `CHANGELOG.md` | local | `@release-it/conventional-changelog` |
| Commit `chore: release v<x.y.z>` | local | release-it |
| Create annotated tag `v<x.y.z>` | local | release-it |
| Push commit + tag | local (manual) | `git push --follow-tags` |
| Create GitHub Release + upload assets | **CI** | `.github/workflows/release.yml` triggered by tag push |

This split exists because the dev machine sits behind an HTTP proxy that Node's octokit (used by release-it for GitHub API calls) cannot traverse. GitHub Actions runners have no such restriction, so the Release step is delegated to CI.

Per `.release-it.json`: `git.push = false`, `github.release = false`. release-it never talks to api.github.com locally.

---

## Phase 1 — Pre-flight Checks

Run simultaneously:

```
git status --short
git rev-parse --abbrev-ref HEAD
git log --format='%s' origin/main..HEAD
```

Requirements (abort with clear message if any fails):

- Working directory **clean** (no uncommitted changes)
- Current branch is **main**
- At least one commit ahead of `origin/main` is fine; being behind is **not** fine — pull first

No `GITHUB_TOKEN` or `gh auth` is needed locally anymore (the CI workflow uses the auto-provided `GITHUB_TOKEN`).

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

Always run a dry-run first to preview what release-it will do. **Always pass `--ci`** so release-it does not prompt interactively for each step (dry-run does not modify anything, so auto-confirming is safe):

```
npm run release:dry -- <bump> --ci
```

**Do NOT pipe through `tee` / `tail` / `head`** — release-it's output is line-buffered and pipes hide interactive prompts; even with `--ci`, pipes can delay output. Run unpiped, or redirect: `> /tmp/dry.log 2>&1` and read the file after.

If you forget `--ci`, the command will appear to hang silently because release-it is waiting on a `(y/N)` prompt that the pipe is buffering.

Show the full output to the user. Confirm in particular:

- Old → new version is what the user chose
- Commit list matches what's actually in the changelog section
- The dry-run shows `! git tag ...` but **does NOT show** `! git push` or `! octokit repos.createRelease` (because they're disabled in `.release-it.json` — if they appear, the config drifted and you must stop)

Then **stop and explicitly ask: "Proceed with the real release?"** Wait for `yes` (or equivalent). Do not proceed on silence or ambiguity.

---

## Phase 4 — Execute Local Release

```
npm run release -- <bump> --ci
```

This bumps `package.json`, runs `npm run build`, writes `CHANGELOG.md`, commits `chore: release v<x.y.z>`, and creates an annotated tag `v<x.y.z>` — all **local**. Nothing is pushed.

A `WARNING Environment variable "GITHUB_TOKEN" is required... Falling back to web-based GitHub Release` line may appear. Ignore it — we don't need it; CI handles the Release.

---

## Phase 5 — Push (USER CONFIRMS — pushing the tag triggers CI)

Show the user what's about to be pushed:

```
git log --oneline origin/main..HEAD
git tag --list 'v*' --points-at HEAD
```

Then **stop and ask: "Push commit + tag to origin/main? This will trigger the Release workflow."** Wait for explicit confirmation.

On confirmation:

```
git push --follow-tags origin main
```

---

## Phase 6 — Watch CI & Verify

After push, the `Release` workflow (`.github/workflows/release.yml`) triggers on the new `v*` tag. It checks out, runs `npm ci && npm run build`, verifies `package.json` version matches the tag, extracts the latest section from `CHANGELOG.md` as release notes, and uploads both `.user.js` files via `softprops/action-gh-release@v2`.

Monitor the run and verify the result:

```
gh run watch --exit-status            # or: gh run list --workflow=release.yml --limit 3
gh release view v<x.y.z>
```

Confirm:

- Workflow succeeded
- Release page exists with both `auto-approve-deploy.user.js` and `auto-approve-deploy.min.user.js` attached
- Release notes match the latest CHANGELOG section
- `@version` in the built userscript matches the tag

Report the release URL to the user.

---

## Edge Cases (ALL require explicit user confirmation before acting)

- **No conventional commits since last tag**: release-it still works but the `CHANGELOG.md` section will be empty. Warn the user and ask whether the release is still meaningful.
- **Build fails during `after:bump`**: release-it aborts before tagging. Report the failure, fix the build, then ask before re-running.
- **Tag already exists locally**: indicates a previous incomplete release. **Never delete tags automatically.** Show the user the local + remote tag state and ask before running `git tag -d v<x.y.z>` (and `git push --delete origin v<x.y.z>` if remote).
- **Tag pushed but CI failed**: tag is on remote, no Release exists. Either re-run the workflow (`gh run rerun <id>`) or create the Release manually with `gh release create v<x.y.z> --notes-file <notes> auto-approve-deploy.user.js auto-approve-deploy.min.user.js`. Do not delete and re-tag.
- **First release**: no prior tag exists. release-it uses `package.json` version as the base; ask the user what initial version to publish.
- **Hotfix on non-main branch**: not supported by current config (`requireBranch: main`). Abort and instruct user to merge to main first.
- **Working tree dirty / unrelated unpushed commits**: stop and ask the user how to handle them — never stash/discard without confirmation.

## Confirmation Checklist

The user must explicitly answer before the release reaches GitHub:

1. Which version bump (Phase 2)
2. "Proceed with the real release?" after dry-run (Phase 3)
3. "Push commit + tag?" before triggering CI (Phase 5)
4. Any edge-case prompt that involves deleting tags or modifying history

If any of the above was not explicitly confirmed, **stop and ask**.
