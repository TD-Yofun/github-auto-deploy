# Auto-Approve Deploy Gates

**English** | [中文](README.zh-CN.md)

A Tampermonkey userscript that automatically approves GitHub Actions deployment gates — no more manual clicking through multi-environment deploy pipelines.

**No GitHub token required.** The script detects the break-glass button via DOM and clicks through the confirmation dialog using your existing browser session.

Built with **Vite + TypeScript**, outputs `build/auto-approve-deploy.user.js` (dev) and `build/auto-approve-deploy.min.user.js` (minified) as bundled userscripts. The `build/` folder is gitignored — artifacts are produced by CI and published to GitHub Releases.

## Features

- **DOM-only auto-approver** — Prefers GitHub's "Review deployments" flow, checks every pending deployment, then clicks "Approve and deploy"; falls back to "Start all waiting jobs"
- **Targets only `Deploy (PRD)` runs** — Activates only when the page header workflow label matches `Deploy (PRD)` (substring match, emoji-prefix tolerant)
- **Auto-stop + summary report** — Reads workflow conclusion from the page status badge (`success`/`failure`/`cancelled`/`timed_out`/`skipped`); stops automatically and generates a report
- **Desktop notification** — `GM_notification` pops a system notification when a run reaches a terminal state (click to focus the tab)
- **Copy report as Markdown** — One-click copy of the execution report to clipboard
- **Pause / Resume** — Suspend monitoring without losing counters or session state
- **Background-tab resistant** — Uses a dedicated Web Worker for the poll timer so browsers don't throttle to ≥1 min in background tabs
- **Watchdog auto-reload** — If no progress for 10 minutes, the page reloads and monitoring resumes from session state
- **Persistent across refreshes** — Counters, event timeline, and logs are restored after page reload via `wasRunning()` detection
- **Logs always persisted** — Per-run log buffer survives refresh; download as `aad-run-<runId>.log` anytime
- **Work dashboard** — Replaces GitHub's home page with favorites, my open PRs (merge / CI / review status), review requests and an organization repository search; SSO-aware
- **bfcache safe** — `pageshow.persisted` re-initializes the panel after browser back/forward navigation
- **Global error capture** — `window.error` and `unhandledrejection` are surfaced into the panel log
- **Version check** — Compares against the latest public userscript release asset; outdated scripts are blocked with a prominent install link
- **Multi-tab safe** — Each tab (different `runId`) operates independently; all state is keyed by `runId`

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click the link below to install the userscript:

   - **[auto-approve-deploy.min.user.js](https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js)** (recommended)
   - [auto-approve-deploy.user.js](https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.user.js) (unminified, for debugging)

3. That's it — no token, no configuration required.

## Usage

1. Navigate to a Deploy (PRD) workflow run (`github.com/{owner}/{repo}/actions/runs/{id}`)
2. The side panel appears on the right edge of the page
3. Click **▶ Start** to begin monitoring
4. The script will:
   - Watch the DOM for "Review deployments", check every pending deployment, and approve it; use "Start all waiting jobs" only as a fallback
   - Poll every `interval` seconds as a fallback
   - Auto-stop and show a summary report when the workflow reaches a terminal state
   - Pop a desktop notification with the outcome

### Controls

| Control | Description |
|---------|-------------|
| **▶ Start / ⏹ Stop** | Toggle monitoring |
| **⏸ Pause / ▶ Resume** | Suspend without losing counters; visible only while running |
| **Download icon** | Download the current run's log file (`aad-run-<runId>.log`) |
| **Settings icon** | Open the settings dialog |
| **📋 Copy MD** | (in summary report) copy the execution report as Markdown |

### Settings

A settings icon is added to GitHub's top header (next to the Issues / Pull requests / Inbox icons); the run panel header and the Tampermonkey menu (**⚙ Settings**) open the same dialog. Changes apply immediately. The dialog has a menu on the left and the selected section on the right: **Monitoring** (polling interval, log hint), **Dashboard** (work dashboard on/off, organizations) and **About** (version, links); it reopens on the section you used last, and on narrow screens the menu becomes a row of tabs (arrow keys / Home / End switch sections).

| Setting | Description |
|---------|-------------|
| **Polling interval** | Fallback poll interval in seconds (5–300, default 15); takes effect on the next tick, even while monitoring |
| **Show log file path** | Toggle the log-file hint in the panel (logs are always persisted regardless) |
| **Work dashboard** | Replace GitHub's home page with the dashboard (off = original page) |
| **Organizations** | Organization logins for repository search, comma separated; empty = detect automatically |

### Execution Report & Logs

When monitoring stops (workflow finished or manual stop) a report is shown in the panel and saved, so it is still there after a refresh: result, **monitoring time** (pauses excluded — not the workflow's own run time), pause time, number of approvals, **approved environment names**, start/end time and a timeline. **Copy MD** exports the same data as Markdown. Environment names come from the "Review deployments" dialog labels (falling back to the gate id).

Downloaded logs (`aad-run-<runId>.log`) use `[YYYY-MM-DD HH:MM:SS] [level] message`; the panel shows time only. A heartbeat line is logged every 60 seconds regardless of the polling interval.

### Storage Cleanup

Per-run data (log, session, report) is stored in Tampermonkey storage. On startup the script deletes data of runs not touched for 14 days. Data created before this feature existed is kept for 14 days from the first run of this version, then removed.

### Forced Updates

On every GitHub page load the script compares its `@version` with the latest release (cached for 15 minutes). If it is outdated, **all features are disabled** — no monitoring (including resuming after a refresh), no home-page widgets, no settings; the header settings icon shows a red dot and opens an "Update required" dialog with the install link, and the run panel shows the same notice. If the check itself fails (network/GitHub error), the script proceeds so an in-flight deployment is never locked out. A tab that stays open across a new release is only re-checked on the next page load — or immediately via **Settings → About → Check for updates**, which skips the cache, reports "up to date" or a failed check without locking anything, and locks the script on the spot when a newer release exists.

### Panel Interactions

- Click the **◀ AAD** tab on the right edge to expand/collapse the panel
- **▶** button in the header collapses the panel

### Work Dashboard

On `github.com/` the script replaces GitHub's home page with a dashboard of cards (GitHub's own content is only hidden — turn **Work dashboard** off in the settings to get it back):

- **Search bar** — focus it and type to search repositories of your organization(s); results float over the page, ↑/↓ + Enter open a result, ☆ adds it to the favorites. Organizations are detected automatically (the list GitHub embeds in its home page, then the account switcher, then organizations awaiting SSO), or set in **Settings → Dashboard → Organizations**.
- **Favorite repositories** — your own list (stored in Tampermonkey storage, independent of GitHub's own favorites) with quick links to PRs and Actions. Add with ☆ in the search results, or type `owner/repo` (or paste a repository URL) and press Enter; filter by typing. **Reorder** by dragging a row's handle (⋮⋮) — or focus the handle and press ↑ / ↓; the order is saved. Handles are hidden while a filter is active.
- **My open pull requests** — with merge status (Ready to merge / Conflicts / Behind base / Blocked), CI status and review status. When a PR is blocked on a review request it says who it waits on (e.g. *Awaiting Talkdesk/industries*); hover a chip for GitHub's own explanation. Click the **CI** chip to open a modal with every check (failed first, then needs-approval, running, passed, skipped), their durations, *Required* badges and links to the logs.
- **Review requested** — what is on your plate as a reviewer: pull requests where you were asked **personally** (`user-review-requested`), plus pull requests you **already started reviewing** that are not approved yet (`reviewed-by:@me`, not yours). Requests that only reached you through a team (e.g. CODEOWNERS) are left out on purpose — in a large organization that is hundreds of pull requests. This card is a plain list (title, repository, author, age); merge/CI/review status is only shown for your own pull requests.

Empty and error states show an icon, a title and a short message (nothing to review, SSO hiding results, GitHub unreachable…).

Layout: three equal-width cards; two columns (the last card spans both) below 960 px, one column below 640 px.

Cards in a row share one height and scroll inside, so one long list never stretches the page; each card shows at most 10 (review: 20) entries with a "Showing N of M" footer.

Everything is read from GitHub's own JSON (search page data and the PR page's `page_data/merge_box` and `status_checks`) through your signed-in session; no token is stored or required. Statuses are cached for 2 minutes (per head commit) and the dashboard refreshes when you return to the tab after 3 minutes.

**SSO:** if you are signed in to GitHub but have not authorized an organization's SAML SSO, GitHub returns nothing for its private repositories and pull requests. The dashboard detects this (`sso_organizations` in GitHub's page data) and shows a banner with an **Authorize <org>** button instead of a misleading empty state.

## How It Works

```
                  ┌────────────────────┐
                  │   Page Load (any   │
                  │  github.com page)  │
                  └─────────┬──────────┘
                            │
            ┌───────────────▼───────────────┐
            │ URL = /…/actions/runs/<id>?   │
            │   AND header label matches    │
            │       /Deploy\s*\(PRD\)/      │
            └─┬─────────────────────────────┘
                                  ┌──────────▼───────────────┐
                                  │ Build side panel + log    │
                                  │ store; restore logs;      │
                                  │ resume if previously      │
                                  │ running                   │
                                  └──────────┬────────────────┘
                                             │
                                  ┌──────────▼──────────────┐
                                  │ User clicks ▶ Start     │
                                  └──────────┬──────────────┘
                                             │
                            ┌────────────────▼────────────────┐
                            │ MutationObserver + Worker-based │
                            │ poll loop (interval seconds)    │
                            └────────────────┬────────────────┘
                                             │
                       ┌─────────────────────┼─────────────────────┐
                       │                     │                     │
            ┌──────────▼──────────┐  ┌───────▼───────┐   ┌─────────▼──────────┐
            │ "Review deployments"│  │  Run reached  │   │ No progress for    │
            │ or legacy button    │  │  terminal     │   │ 10 min (watchdog)? │
            │ appears?            │  │  conclusion?  │   └─────────┬──────────┘
            └──────────┬──────────┘  └───────┬───────┘             │ Yes
                       │ Yes                 │ Yes                 ▼
            ┌──────────▼──────────┐  ┌───────▼─────────────┐  ┌─────────────┐
            │ Click → check every │  │ Stop + generate     │  │ location.   │
            │ deployment → approve│  │ summary report →    │  │ reload();   │
            │ enabled dialog      │  │ desktop notification│  │ auto-resume │
            └──────────┬──────────┘  └─────────────────────┘  └─────────────┘
                       │
              ┌────────▼────────┐
              │ Cooldown 5s →   │
              │ continue poll   │
              └─────────────────┘
```

## How Deployment Approval Works

The script prefers GitHub's current review flow:

1. **Click "Review deployments"** → wait for the `js-gates-dialog` dialog → check every `gate_request[]` checkbox → wait for **"Approve and deploy"** to become enabled → click it
2. **Fall back to "Start all waiting jobs"** and its confirmation dialog when the review button is absent
3. If the legacy dialog cannot be completed, use the existing DOM-based fallbacks: programmatic form submission with `gate_request[]` fields collected from the DOM, then a same-origin manual POST using a page CSRF token.

All three rely on your existing browser session cookies — no API token is needed.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18.12
- Corepack (bundled with supported Node.js releases)

### Setup

```bash
corepack enable
yarn install
```

### Build

```bash
yarn build        # both dev + minified
yarn build:dev    # dev only
yarn build:prod   # minified only
```

### Watch Mode

```bash
yarn start            # serve the local userscript for direct GitHub debugging
yarn dev              # alias for yarn start
yarn dev:build        # rebuild the development userscript on change
yarn dev:all          # rebuild both on change
yarn preview:ui       # local UI preview (settings dialog, run panel) at http://127.0.0.1:5173
```

For direct GitHub debugging, run `yarn start` and install the local development
userscript once from [http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js](http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js).
After that, refresh any matching GitHub page after changing source files.

### Project Structure

```
src/
  main.ts              ← Entry point — wires modules, page detection, lifecycle
  core/
    report.ts          ← Report data model + Markdown export (core)
    config.ts          ← Persistent config (interval, saveLog hint, panelVisible, homeDashboard, organizations)
    state.ts           ← Runtime state types + watchdog constant
    log-store.ts       ← Always-on log persistence (batch buffer, debounced flush)
    session.ts         ← Session persistence across refreshes
    scheduler.ts       ← Web Worker-based timer (avoids background tab throttling)
    github.ts          ← Same-origin helpers: embedded page JSON, page_data JSON, SSO links
    pull-requests.ts   ← PR lists + CI / review / mergeability status
    repo-search.ts     ← Organization repository search
    organizations.ts   ← Which organizations to search (setting → GitHub's embedded list → account switcher → SSO list)
    favorites.ts       ← Favorite repositories (GM storage)
    sso.ts             ← Organizations whose SSO is not authorized
    storage-cleanup.ts ← 14-day pruning of per-run storage
    version-check.ts   ← Compare against latest userscript release asset; cache result
  api/
    skip-timers.ts     ← MutationObserver + 3-approach DOM-based clicker
  ui/
    styles.ts          ← Injects compiled Sass through GM_addStyle
    styles.scss        ← Sass entry; partials in styles/ (tokens, components, panel, settings, dashboard)
    settings.ts        ← Header settings entry + settings dialog
    ui.ts              ← Panel build, render, event binding, report rendering
    dashboard/         ← Work dashboard: dashboard.ts (mount), pr-card, favorites-card, search-box, chips, sso-notice
  utils/
    helpers.ts         ← ts(), esc(), formatDuration()
    url.ts             ← URL parsing + Deploy (PRD) page detection
```

### Build Output

| File | Description |
|------|-------------|
| `build/auto-approve-deploy.user.js` | Dev build — unminified, readable (gitignored) |
| `build/auto-approve-deploy.min.user.js` | Prod build — minified JS + compressed CSS/HTML templates (gitignored) |

### Release Flow

Local: `yarn release patch` (release-it) bumps version, builds, commits, tags. Then `git push --follow-tags origin main` triggers `.github/workflows/release.yml` which creates the GitHub Release and uploads both `.user.js` artifacts. See `.agents/skills/release/SKILL.md` for the full workflow.

## License

MIT
