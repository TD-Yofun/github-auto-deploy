# Copilot Instructions

## Project Overview

Tampermonkey userscript that auto-approves GitHub Actions deployment gates on `Deploy (PRD)` workflow runs. It prefers **"Review deployments"**, checks every `gate_request[]`, then clicks **"Approve and deploy"**; **"Start all waiting jobs"** is the legacy fallback. Pure DOM-based — **no GitHub token**. Built with Vite + TypeScript + `vite-plugin-monkey`; outputs `build/auto-approve-deploy.user.js` (dev) and `build/auto-approve-deploy.min.user.js` (prod). The `build/` folder is gitignored — artifacts are produced by CI and uploaded to GitHub Releases.

## Architecture

```
src/
├── main.ts                      # Entry — wires modules, page detection, lifecycle, global error handlers
├── core/
│   ├── config.ts                # GM_getValue/setValue persistent config (interval, saveLog, panelVisible, homeDashboard, organizations)
│   ├── state.ts                 # Runtime state types; exports WATCHDOG_TIMEOUT_MS = 10 * 60 * 1000
│   ├── log-store.ts             # Always-on per-run log buffer with debounced GM_setValue flush
│   ├── storage-cleanup.ts       # Index + 14-day pruning of per-run GM storage keys
│   ├── report.ts                # Report model (buildReport/reportToMarkdown) shared by panel + Markdown
│   ├── session.ts               # SessionData (cross-refresh resume); keyed by runId
│   ├── scheduler.ts             # Web Worker-based scheduleTick/cancelTick (avoids background tab throttling)
│   ├── github.ts                # Same-origin helpers: embedded page JSON, page_data JSON, SSO URL
│   ├── pull-requests.ts         # PR lists (/pulls/search JSON) + status (page_data/merge_box, status_checks)
│   ├── repo-search.ts           # Org repo search (search page blackbirdSearchRoute JSON)
│   ├── organizations.ts         # Orgs to search: setting → embedded userOrganizations → switcher (+ lazy fragment) → SSO list
│   ├── favorites.ts             # Favorite repos in GM storage
│   ├── sso.ts                   # Orgs whose SSO is unauthorized (results come back empty)
│   └── version-check.ts         # Compare vs latest userscript release asset; cache result; block outdated
├── api/
│   └── skip-timers.ts           # MutationObserver + 3 click strategies for the gate button
├── ui/
│   ├── styles.ts                # Injects compiled Sass via GM_addStyle
│   ├── styles.scss              # Sass entry; partials in styles/ (tokens use Primer vars → light/dark)
│   ├── settings.ts              # Header settings entry (.AppHeader-actions) + settings dialog
│   ├── ui.ts                    # Panel HTML/render/event binding; summary report + Markdown export
│   └── dashboard/               # Work dashboard replacing the GitHub home (dashboard.ts mounts into .application-main)
└── utils/
    ├── helpers.ts               # ts(), esc(), formatDuration()
    └── url.ts                   # parseRunUrl() + isDeployPrdPage() (matches /Deploy\s*\(PRD\)/)
```

## Critical Conventions

### Tampermonkey grants (vite.config.ts)

```
GM_addStyle, GM_getValue, GM_setValue,
GM_notification, GM_listValues, GM_deleteValue, unsafeWindow
```

- `GM_notification` — desktop notification on terminal conclusion (click → focus tab)

### Storage keys (all keyed by `runId`)

| Key | Purpose |
|-----|---------|
| `aad_config` | Global config (interval, saveLog, panelVisible, homeDashboard, organizations) |
| `aad_running_${runId}` | `true` while monitoring; used by `wasRunning()` for resume |
| `aad_session_${runId}` | SessionData (counters, timeline, `lastProgressAt`) |
| `aad_log_${runId}` | Persisted log buffer (always written; never gated) |
| `aad_report_${runId}` | Final execution report (shown again after refresh) |
| `aad_run_index` | `{runId: lastTouchedAt}`; drives the 14-day cleanup in `core/storage-cleanup.ts` |
| `aad_version_check` | Cached latest release check |

### State fields (state.ts)

- `running: boolean` — main on/off
- `paused: boolean` — pause toggle; when true, observer detached and tick is a heartbeat only
- `lastProgressAt: number` — updated on every successful click/event; watchdog reloads page after `WATCHDOG_TIMEOUT_MS` of no progress
- `counters` + `timeline[]` + `pausedMs`/`pausedAt` — surfaced via `core/report.ts` (`buildReport`); the final report is persisted as `aad_report_${runId}` so it survives refresh
- Approve events carry `environments[]` (from `trySkipWaitTimers → SkipResult`); log lines are stored with a full date, the panel shows time only

### Activation conditions

`main.ts → checkPage()` runs on every navigation event:
1. URL must match `/{owner}/{repo}/actions/runs/{id}` → `parseRunUrl()`
2. Page header workflow label must match `/Deploy\s*\(PRD\)/i` → `isDeployPrdPage()` (substring/emoji-prefix tolerant)
3. If both → build/restore the panel; otherwise only the GitHub home work dashboard is considered

### Scheduler (scheduler.ts)

- Default: dedicated Web Worker via `Blob` URL with `self.onmessage` handling `{type:'start', ms}` / `{type:'stop'}`. Worker `setTimeout` is not throttled in background tabs.
- Fallback: `setTimeout` when Worker unavailable.
- Always use `scheduleTick(cb, ms)` / `cancelTick()` — never call `setTimeout` directly for the poll loop.

### Logs always persisted

`log-store.appendLogToStore()` is **not** gated by `_saveLog`. The `💾 Log` toggle only controls the hint text in the panel; logs are always written and always downloadable. **Do not re-add the gate.**

### Conclusion detection

`main.ts → readRunConclusion()`:
1. Primary: `.actions-workflow-runs-status svg[aria-label]` — aria-label text contains keywords (`succeeded`, `failed`, `cancelled`, `timed out`, `skipped`, `in progress`)
2. Fallback: scan for elements with `color-fg-success` / `color-fg-danger` / `color-fg-attention` classes
3. `isTerminalConclusion(c)` matches terminal states → triggers auto-stop + summary + notification

### Watchdog (10 min)

In `poll()`: if `now - state.lastProgressAt > WATCHDOG_TIMEOUT_MS` while running and not paused → reset `lastProgressAt` before persisting state, then `location.reload()`. Resume path (`wasRunning()`) re-arms everything without immediately re-triggering the watchdog.

### bfcache & error capture (main.ts)

```ts
window.addEventListener('pageshow', (e) => {
  if (e.persisted) setTimeout(checkPage, 200);
});
window.addEventListener('error', /* → log */);
window.addEventListener('unhandledrejection', /* → log */);
```

### Pause/Resume

- `pauseMonitoring()` → disconnect observer + `cancelTick()`, keep `state.running = true`, set `state.paused = true`, start heartbeat tick
- `resumeMonitoring()` → re-arm observer, reset `lastProgressAt = Date.now()`, clear `paused`, schedule next tick
- `bindPanelEvents()` wires `#aad-pause-btn`; `renderToggle(el, running, paused)` shows label correctly

### Work dashboard (ui/dashboard/)

- `mountDashboard(enabled, orgs)` runs from `checkPage()`; on `/` it adds `html.aad-home` (CSS hides every `.application-main` child except `#aad-dashboard`) and prepends the dashboard. Leaving `/` or turning it off removes both, restoring GitHub's page. A MutationObserver re-attaches it after Turbo navigations.
- **Never scrape HTML links** — GitHub's pages are React apps. Read `script[data-target="react-app.embeddedData"]` (`fetchEmbeddedPayload`): `/pulls/search` → `pullsDashboardSurfaceContentRoute.results`, `/search?type=repositories` → `blackbirdSearchRoute.results`. PR status uses `pull/<n>/page_data/merge_box` and `page_data/status_checks` with `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, `GitHub-Verified-Fetch: true` (`fetchJson`).
- **SSO:** without an authorized SSO session GitHub returns empty results; `pullsDashboardSurfaceLayoutRoute.sso.sso_organizations` is the authoritative list (`core/sso.ts`). `protected_org_logins` in search is NOT proof of missing SSO (listed regardless).
- Status mapping lives in `deriveStatus()` (pure, `core/pull-requests.ts`). **`statusRollup.combinedState` is PASSED / FAILED / PENDING / PENDING_APPROVAL, not the REST API's SUCCESS / FAILURE** — an earlier version only recognized SUCCESS and showed every green PR as "CI running". The per-state `summary` counts are the primary signal; `combinedState` is only a fallback. `PENDING_APPROVAL` is its own CI state (fork workflows waiting for approval).
- "Blocked" is explained from `pendingReviewRequests` (team logins look like `org/team`) and the first failed `mergeRequirements` condition; the message repeats sentences, so it is de-duplicated.
- **Review queue** (`review`): only what is personal to the user — `user-review-requested:@me` (asked directly) plus `reviewed-by:@me -author:@me -review:approved` (I started reviewing, not approved yet), requests first, de-duplicated. `review-requested:@me` was rejected: it also matches *team* requests, which was 548 PRs (62% bots) for one real account. `-author` / `-review:approved` partition `reviewed-by` exactly (checked: 25 = 23 + 2). `&page=N` paginates search (25 per page).
- **Favorite tags** (`core/favorites.ts`): separate storage key `favorite_tags` (`{ "owner/repo" lower-cased: string[] }`) so the ordered `favorite_repos` list is untouched (no migration). `normalizeTag` trims, drops a leading `#`, collapses spaces, caps at 24 chars; tags are case-insensitive and a new spelling reuses the existing one (so tabs never show "Backend" and "backend"). Tabs = **All first (default, never persisted)** + one per tag in use, alphabetical, in ONE horizontally scrolling row (the owner asked for this; wrapping was tried first). Mitigations that must stay: edge fades via `data-fade` + `mask-image`, vertical mouse wheel → sideways scroll (handing back to the page at either end, honoring `deltaMode`), the selected tab is scrolled into view only on *selection* (never on re-render, or it undoes manual scrolling), keyboard focus uses `preventScroll`. A long tag name is truncated, its count is not. Removing a favorite deletes its tags; a tab whose last carrier loses the tag disappears and the selection falls back to All. Adding a repo on a tag tab tags it. Reorder is only offered on All without a text filter. Tag changes notify `subscribeFavorites` like list changes.
- **Search scope = organizations + the signed-in user**: `searchRepositories(orgs, keyword, user)` builds `org:a org:b user:me …` (GitHub ORs `org:`/`user:` qualifiers — verified live). The login comes from `meta[name=user-login]` (`getCurrentLogin()`); SSO notice is shown when no organization produced a hit even if personal repos did.
- **Favorite row = name + tags only**: owner is muted, repo bold. Drag handle (full row height, 16px wide, in the card body's left padding via `left: -16px` — it must not overlay the name; buttons don't stretch between `top`/`bottom`, so it sets `height: calc(100% - 4px)`; rows are `.aad-fav-line` + the tag editor, so the editor never counts toward the handle), PR / Actions shortcuts and tag / remove buttons are absolutely positioned and shown on `:hover` / `:focus-within` / while the tag editor is open (always on `@media (hover: none)`), so hovering never reflows the row. Don't add always-visible controls here.
- **Tag tab strip**: `layoutTabs()` sets `data-rows` to `1`, or `2` (CSS grid, column-major, still scrolls sideways) when the tabs overflow one row; it runs on every render and on resize.
- **Favorite order = stored order** (`moveFavorite(name, position)`; `position` is a *gap* 0…length, as drag-and-drop yields). The row is `draggable` only while its handle is pressed, so links/text stay selectable; handles are hidden while filtering because filtered rows don't map to positions. Keyboard: ↑/↓ on the handle, focus restored after the re-render.
- **Favorites are ours only** (`core/favorites.ts`, GM storage). GitHub's own sources were evaluated and dropped: `/dashboard/my_top_repositories` ignores every query param and is capped at 7, and GitHub's native favorites (`/dashboard/favorites.json`) is a separate feature the user chose not to use.
- Status (merge / CI / review chips, the CI details modal) exists **only on "My open pull requests"** (`showStatus`). The review card is a plain list and must not fetch `page_data/*` (it is 2 requests per row). `PullRequestStatus.checks` keeps every check so the modal (`ci-modal.ts`) opens from `statusCache` without another request.
- **Organization detection**: the account switcher's list is a *lazy* `include-fragment` that is empty at page load once SSO is authorized, and an empty answer used to be cached — so search silently had no organization. Order now: setting → `copilot-chat-input-partial` embedded `props.userOrganizations` (always on the page) → switcher links / its `ajax_context_list` fragment → SSO list; an empty result is never cached.
- **Icons**: use the shared stroke SVGs in `ui/icons.ts` (`currentColor`, so they follow light/dark), not emoji, for new UI. Titles use `.aad-title-icon`, rows `.aad-row-icon`, chips get a 12px icon via `.aad-chip .aad-icon`; transport icons (play/pause/stop) are filled. Never use GitHub's `.octicon` class (it forces `fill`).
- **Settings dialog**: left menu (`TABS` in `ui/settings.ts`: Monitoring / Dashboard / About) + panes, WAI-ARIA tabs (roving `tabindex`, ←/→/↑/↓/Home/End, selection follows focus), remembers the last pane, menu becomes a top row below 600 px. Add a setting = add it to the right pane's `body()`.
- **Modals** (settings, CI details): use the shared `.aad-modal-overlay` (dim + `backdrop-filter: blur`, `overscroll-behavior: contain`) and call `lockScroll()` when opening / `unlockScroll()` when closing (`ui/scroll-lock.ts`, reference-counted; only unlock if an overlay was actually removed). A Turbo navigation removes the overlay without calling close, so the lock also resets itself on `turbo:load` / `turbo:render` / `pageshow` when no overlay is left.
- Empty/error states always go through `renderEmptyState()` (icon + title + message), never a bare text line.
- Layout: **three equal-width cards** (`repeat(3, minmax(0,1fr))`; 2 columns below 960 px with the last card spanning, 1 below 640 px). The search box is full width (no visible title; the `h1` is screen-reader only) so it lines up with the outer card edges; cards stretch to the tallest (capped) and scroll inside.
- Always `target="_blank"` links; escape everything with `esc()`/`renderMarked()` (search highlights arrive as `<em>` markers).

### Cross-refresh resume

- `wasRunning(runId)` checks `aad_running_${runId}`
- On `checkPage()` for a Deploy (PRD) run, if running flag set → auto-resume `start()` after panel build
- Counters/timeline come from `aad_session_${runId}`; logs from `aad_log_${runId}`

### Multi-tab

All state is keyed by `runId`, so multiple tabs running different deploys are independent.

## Build & Release

- `yarn build` → both dev + minified into project root
- `yarn build:dev` / `yarn build:prod` → individual builds
- `yarn start` / `yarn dev` → local userscript server for direct GitHub debugging; install `__vite-plugin-monkey.install.user.js` once in Tampermonkey
- `yarn dev:build` / `yarn dev:all` → build watch modes
- `yarn preview:ui` → local Vite preview (settings dialog, run panel)
- **Always run `yarn build` after touching `src/**`** before committing — both `.user.js` files must be in sync with source.
- Release: `yarn release patch|minor|major` (release-it bumps + builds + commits + tags), then `git push --follow-tags origin main` → `.github/workflows/release.yml` creates GitHub Release with both artifacts. Full procedure: `.agents/skills/release/SKILL.md`.

## Commit Convention

Conventional Commits enforced by commitlint. See `.agents/skills/commit/SKILL.md` — includes mandatory **Phase 3 docs-sync check** that prompts the user about updating `README.md` / `README.zh-CN.md` / `.github/copilot-instructions.md`.

## Do / Don't

- ✅ Use `scheduleTick` / `cancelTick` for any periodic work
- ✅ Key all new persistent state by `runId` **and** use the `aad_<kind>_` prefix list in `storage-cleanup.ts` (`RUN_KEY_PREFIXES`) so it is pruned after 14 days
- ✅ Update `lastProgressAt` on any meaningful action so watchdog doesn't trigger
- ✅ The manual **Check for updates** (Settings → About) calls `checkLatestVersion(current, true)` (skips the 15-min cache) and, if outdated, goes through the same `blockForUpdate()` + `checkPage()` as the automatic gate; a *failed* check must never lock anything.
- ✅ Keep the forced-update gate in `main.ts` (`versionGate`): `checkPage()` must do nothing while `pending`, and no feature may start/mount while `blocked`; a failed check fails open
- ❌ Don't gate log writes behind the `saveLog` flag
- ❌ Don't call `setTimeout` directly for the main poll loop
- ❌ Don't add a GitHub token flow — DOM only
- ❌ Don't run the script on non-Deploy (PRD) workflow runs (the label check exists to keep behavior scoped)
