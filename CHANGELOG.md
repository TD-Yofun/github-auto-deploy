

## [1.0.2](https://github.com/TD-Yofun/talkdesk-auto-deploy/compare/v1.0.1...v1.0.2) (2026-05-16)


### ⚠ BREAKING CHANGES

* GitHub token is no longer used or stored. The script now relies entirely on the in-page "Start all waiting jobs" button being visible to the current user.

### Refactor

* switch to DOM-only mode, remove github token dependency ([d26a2e4](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/d26a2e49530b9327e88f1529da1766fe126d74a0))


### Documentation

* clarify why octokit fails behind proxy in release skill ([b5c969a](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/b5c969adb549ecd9a48c5dcd3fff81a1883c0633))
* note release-it dry-run needs --ci and avoid pipes ([b9f071e](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/b9f071e760e16f3552e28b3dbaaf83259d758a00))
* require explicit user confirmation in release skill ([d2ee96f](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/d2ee96fc4f9940632e499800d25a0b5008abecb3))

## 1.0.1 (2026-05-16)


### Features

* add api-based skip fallback and persist panel visibility ([4c31e9b](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/4c31e9bcc087c64539dd4191f296b0165df7f7bc))
* add Auto-Approve Deploy Gates Tampermonkey userscript ([b55d654](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/b55d6545f50684a6168a9233d5c5a49914ca8ea6))
* add MutationObserver for real-time skip button detection ([53e9d30](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/53e9d3016f2b2044a270e892979e1b6401424084))
* enforce version check to block outdated script ([854f958](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/854f9585641646ff3db071a0fbb16936d4aa797f))
* remove close button and add url change detection ([b22bbf2](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/b22bbf247f104d3a195c725bce695cab915f2a69))
* side panel UI + execution summary report ([4b43424](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/4b434245598b9464d7e956de32468e475d1c038f))


### Bug Fixes

* persist session counters across page refreshes ([fbd6960](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/fbd6960744262676a54f694f2984fed58fdda6fb))
* remove unnecessary page refresh after approve, fix empty names, reduce poll interval ([c887dc5](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/c887dc57e7bcc1377e371a10b1fe0c8c28e662ea))
* resolve typescript error in vite config userscript type ([70506d2](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/70506d285fd9384684e265070394f86b0ed43f04))


### Refactor

* migrate to vite + typescript modular architecture ([aac24bd](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/aac24bd6e38c45bab70db84f89343f298e0ef1c2))
* optimize log storage, fix variable shadowing, improve controls disable logic ([e5e43d4](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/e5e43d48814a1b19b5d8a6056b1e31b175f23946))


### Documentation

* add .github/copilot-instructions.md ([bfccf22](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/bfccf226ae8a375b1b8b88776f4d88201c9f4469))
* add Chinese README with language toggle links ([a1ba93a](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/a1ba93aec6135df8b41f02bde2a7c2fe5ed2e9ce))
* add README ([882d46b](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/882d46b86573ff4f41500a98ed4c521bbf11ee23))
* fix inaccurate README descriptions (panel type, interval, interactions) ([35ab2fe](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/35ab2fe5f8db06561ab42568b2eb66f3193c7271))
* remove references to deleted auto-approve-deploy.sh ([baca26e](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/baca26e6305f74f1d19d6b96db72c604f41f07ca))
* replace mermaid flowcharts with ascii art ([a1f9bcf](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/a1f9bcf5c28b8a9df8273577e5760c315ed24727))
* update readme with vite+ts development guide ([837b538](https://github.com/TD-Yofun/talkdesk-auto-deploy/commit/837b538e64db6f60c7d9ee4ea67131b78a07c892))
