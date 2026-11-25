# Auto-Approve Deploy Gates

[English](README.md) | **中文**

一个 Tampermonkey 用户脚本，自动批准 GitHub Actions 的部署门控——再也不用手动一环一环地批准多环境部署流水线。

**无需 GitHub Token。** 脚本通过 DOM 检测 break-glass 按钮，并基于你浏览器现有的登录会话点过确认弹窗。

使用 **Vite + TypeScript** 构建，产出 `build/auto-approve-deploy.user.js`（开发版）和 `build/auto-approve-deploy.min.user.js`（压缩版）两个打包后的 userscript。`build/` 目录已被 gitignore —— 构建产物由 CI 生成并发布到 GitHub Releases。

## 功能特性

- **纯 DOM 自动批准器** —— 优先检测 GitHub 的 "Review deployments"，勾选全部待部署环境后点击 "Approve and deploy"；找不到时再回退到 "Start all waiting jobs"
- **仅对 `Deploy (PRD)` 生效** —— 仅当页面头部 workflow label 匹配 `Deploy (PRD)`（子串匹配，容忍 emoji 前缀）时才激活
- **自动停止 + 总结报告** —— 从页面状态徽标读取 workflow 结论（`success`/`failure`/`cancelled`/`timed_out`/`skipped`），命中终态后自动停止并生成报告
- **桌面通知** —— `GM_notification` 在 run 进入终态时弹出系统通知（点击聚焦标签页）
- **报告复制为 Markdown** —— 一键将执行报告复制到剪贴板
- **暂停 / 恢复** —— 在不丢失计数器和会话状态的情况下暂停监控
- **后台标签页抗节流** —— 使用专用 Web Worker 调度轮询，避免浏览器将后台标签页节流到 ≥1 分钟
- **看门狗自动刷新** —— 若 10 分钟无进展则自动 reload 页面，并基于 session 恢复监控
- **跨刷新持久化** —— 通过 `wasRunning()` 检测，刷新后自动恢复计数器、事件时间线和日志
- **日志始终持久化** —— 每个 run 的日志缓冲区跨刷新保留，可随时下载 `aad-run-<runId>.log`
- **工作面板** —— 用常用仓库、我的 Open PR（合并 / CI / Review 状态）、需要我 Review 的 PR 和组织仓库搜索替换 GitHub 首页；支持识别 SSO 未授权
- **组织仓库搜索** —— 在 `github.com/` 首页加载你所属的组织，并按关键词搜索组织仓库；结果点击后在新标签页打开
- **bfcache 安全** —— 通过 `pageshow.persisted` 在浏览器前进/后退后重新初始化面板
- **全局错误捕获** —— `window.error` 和 `unhandledrejection` 会输出到面板日志
- **版本检查** —— 与最新公开 userscript release asset 比对，过期脚本会被显眼地拦截并提供安装链接
- **多标签页安全** —— 每个标签页（不同 `runId`）独立运行，所有状态按 `runId` 隔离

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击下方链接安装 userscript：

   - **[auto-approve-deploy.min.user.js](https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js)**（推荐）
   - [auto-approve-deploy.user.js](https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.user.js)（未压缩，方便调试）

3. 完成——无需 token、无需配置。

## 使用方法

1. 打开一个 Deploy (PRD) workflow run（`github.com/{owner}/{repo}/actions/runs/{id}`）
2. 页面右侧会出现侧边面板
3. 点击 **▶ Start** 开始监控
4. 脚本将会：
   - 优先监听 DOM 中的 "Review deployments"，勾选全部待部署环境并批准；缺失时回退到 "Start all waiting jobs"
   - 每 `interval` 秒兜底轮询一次
   - 当 workflow 进入终态时自动停止并显示总结报告
   - 弹出桌面通知告知结果

### 控件

| 控件 | 说明 |
|------|------|
| **▶ Start / ⏹ Stop** | 切换监控状态 |
| **⏸ Pause / ▶ Resume** | 暂停（不丢失计数器），仅运行时可见 |
| **下载图标** | 下载当前 run 的日志文件（`aad-run-<runId>.log`） |
| **设置图标** | 打开设置对话框 |
| **📋 Copy MD** | （在总结报告中）将执行报告复制为 Markdown |

### 设置

GitHub 顶部 header 图标区（Issues / Pull requests / Inbox 旁）新增了设置入口；运行面板标题栏和 Tampermonkey 菜单（**⚙ Settings**）打开的是同一个对话框。修改即时生效。对话框左侧是菜单、右侧是所选内容：**Monitoring**（轮询间隔、日志提示）、**Dashboard**（工作面板开关、组织）和 **About**（版本、链接）；下次打开会停在上次使用的菜单，窄屏时菜单变成顶部标签行（方向键 / Home / End 切换）。

| 设置项 | 说明 |
|--------|------|
| **Polling interval** | 兜底轮询间隔秒数（5–300，默认 15），监控中修改也会在下一次 tick 生效 |
| **Show log file path** | 切换面板中日志文件提示的显示（无论开关如何，日志始终持久化） |
| **Work dashboard** | 用工作面板替换 GitHub 首页（关闭即恢复原页面） |
| **Organizations** | 仓库搜索使用的组织 login，逗号分隔；留空则自动识别（你个人账号始终会一并搜索） |

### 执行报告与日志

监控结束（workflow 进入终态或手动停止）时，面板会显示并保存报告，刷新页面后仍可查看：结果、**监控时长**（不含暂停，不等于 workflow 自身运行时长）、暂停时长、审批次数、**审批的环境名**、开始/结束时间和时间线。**Copy MD** 导出同一份数据的 Markdown。环境名取自 "Review deployments" 弹窗中的标签文本（取不到时回退为 gate id）。

下载的日志（`aad-run-<runId>.log`）格式为 `[YYYY-MM-DD HH:MM:SS] [level] message`，面板里只显示时间。无论轮询间隔多少，心跳日志固定每 60 秒一条。

### 存储清理

每个 run 的数据（日志、会话、报告）存放在 Tampermonkey 存储中。脚本启动时会删除 14 天未使用的 run 数据；本功能上线之前遗留的数据，从该版本首次运行起保留 14 天后清除。

### 强制更新

每次加载 GitHub 页面时，脚本会对比自身 `@version` 与最新 Release（缓存 15 分钟）。版本过期时**所有功能被禁用**：不能监控（包括刷新后的自动恢复）、不显示首页组件、不能打开设置；顶部设置图标显示红点，点击弹出带安装链接的「Update required」对话框，运行面板也显示同样的提示。若版本检查本身失败（网络/GitHub 异常），脚本会放行，避免锁死正在进行的部署。长期不刷新的标签页要到下次加载页面才会重新检查——也可以用 **设置 → About → Check for updates** 立即检查：它会跳过缓存；已是最新或检查失败时只给出提示、不会锁定任何功能；发现新版本时立刻锁定。

### 面板交互

- 点击右侧边缘的 **◀ AAD** 标签展开/收起面板
- 标题栏的 **▶** 按钮收起面板

### 工作面板

在 `github.com/` 首页，脚本用卡片式面板替换 GitHub 原生首页内容（只是隐藏：在设置里关闭 **Work dashboard** 即可恢复原页面）：

- **搜索框** —— 聚焦后输入即可同时搜索组织内的仓库**和你个人账号下的仓库**（当前登录用户从页面读取，无需配置），结果以悬浮框显示；↑/↓ 选择、Enter 打开、☆ 加入常用仓库。组织会自动识别（先读 GitHub 首页内嵌的组织列表，再读账号切换器，最后是待授权 SSO 的组织），也可在 **设置 → Dashboard → Organizations** 中指定。
- **常用仓库** —— 我自己的收藏列表（存于 Tampermonkey 存储，与 GitHub 自带的收藏无关），带 PRs / Actions 快捷链接。在搜索结果里点 ☆ 添加，或输入 `owner/repo`（或粘贴仓库 URL）后按 Enter 添加；输入即过滤。**标签**：点每行的标签按钮给仓库打标签（输入后回车，或点选已有标签）；标签会以标签页形式显示在列表上方——**All 永远是第一个且默认选中**，后面是每个标签一页（按字母序，带数量），放得下时排成一行，放不下时自动排成两行，并支持横向滚动（鼠标滚轮、触控板或方向键；渐隐的边缘提示还有更多标签），标签页内仍可文字筛选；每一行默认只显示仓库名和标签，拖拽手柄（位于卡片左内边距、占满整行高度）、PRs / Actions 快捷入口和标签 / 删除按钮在悬停或键盘聚焦时才出现；在某个标签页下新增仓库会自动带上该标签。**手动排序**：拖动每行左侧的手柄（⋮⋮），或聚焦手柄后按 ↑ / ↓，顺序会被保存；手柄只在 **All** 页且没有筛选词时显示。
- **我的 Open PR** —— 带合并状态（可合并 / 冲突 / 落后 / 被阻止）、CI 状态和 Review 状态。如果因为等待 review 而被阻止，会直接写明在等谁（例如 *Awaiting Talkdesk/industries*）；悬停标签可看 GitHub 的原始说明。点击 **CI** 标签会弹出 modal，列出全部检查项（失败的在前，其次是需要审批、运行中、通过、跳过），含耗时、*Required* 标记和日志链接。
- **需要我 Review 的 PR** —— 只显示和你个人相关的 review：**点名我的请求**（`user-review-requested`），加上**我已经开始 review、还没整体通过的 PR**（`reviewed-by:@me`，不含我自己的 PR）。只是通过团队（如 CODEOWNERS）间接到达我的请求被有意排除——在大型组织里那会是几百条。该卡片只是简单列表（标题、仓库、作者、时间），合并 / CI / Review 状态只在我自己的 PR 上显示。

空状态和错误状态统一显示「图标 + 标题 + 说明」（无需 review、SSO 隐藏了结果、GitHub 无法访问等）。

布局：三张等宽卡片；宽度低于 960px 时变成两列（最后一张撑满整行），低于 640px 时单列。

同一行的卡片等高，内容过长时在卡片内部滚动，不会把页面撑长；每张卡片最多显示 10 条（review 卡片 20 条），底部有 "Showing N of M" 说明。

所有数据都通过已登录会话读取 GitHub 自身的 JSON（搜索页数据，以及 PR 页面的 `page_data/merge_box` 和 `status_checks`），不保存也不需要 Token。状态按 head commit 缓存 2 分钟，切回标签页超过 3 分钟会自动刷新。

**SSO：** 如果已登录 GitHub 但没有授权某个组织的 SAML SSO，GitHub 对该组织的私有仓库和 PR 什么都不返回。面板会通过页面数据中的 `sso_organizations` 识别这种情况，并显示带 **Authorize <组织>** 按钮的提示，而不是误导性的空列表。

## 工作原理

```
                  ┌────────────────────┐
                  │   页面加载（任意    │
                  │  github.com 页面） │
                  └─────────┬──────────┘
                            │
            ┌───────────────▼───────────────┐
            │ URL 是 /…/actions/runs/<id>?  │
            │    且头部 label 匹配          │
            │       /Deploy\s*\(PRD\)/      │
            └─┬─────────────────────────────┘
                                  ┌──────────▼───────────────┐
                                  │ 构建侧边面板 + 日志存储；  │
                                  │ 恢复日志；若上次在运行    │
                                  │ 则自动恢复                │
                                  └──────────┬────────────────┘
                                             │
                                  ┌──────────▼──────────────┐
                                  │ 用户点击 ▶ Start        │
                                  └──────────┬──────────────┘
                                             │
                            ┌────────────────▼────────────────┐
                            │ MutationObserver + Worker 调度   │
                            │ 轮询循环（每 interval 秒）       │
                            └────────────────┬────────────────┘
                                             │
                       ┌─────────────────────┼─────────────────────┐
                       │                     │                     │
            ┌──────────▼──────────┐  ┌───────▼───────┐   ┌─────────▼──────────┐
            │ "Review deployments"│  │  Run 命中     │   │ 10 分钟无进展？     │
            │ 或旧版按钮出现？     │  │  终态？       │   │ （看门狗）          │
            └──────────┬──────────┘  └───────┬───────┘   └─────────┬──────────┘
                       │ 是                  │ 是                  │ 是
            ┌──────────▼──────────┐  ┌───────▼─────────────┐  ┌─────────────┐
            │ 点击 → 勾选全部环境  │  │ 停止 + 生成总结报告 │  │ location.   │
            │ → 批准已启用的对话框 │  │ → 桌面通知          │  │ reload();   │
            └──────────┬──────────┘  └─────────────────────┘  │ 自动恢复    │
                       │                                       └─────────────┘
              ┌────────▼────────┐
              │ 冷却 5s → 继续  │
              │ 轮询             │
              └─────────────────┘
```

## 部署批准实现

脚本优先采用 GitHub 当前的审核流程：

1. **点击 "Review deployments"** → 等待 `js-gates-dialog` 对话框 → 勾选全部 `gate_request[]` 复选框 → 等待 **"Approve and deploy"** 解除禁用 → 点击批准
2. 找不到审核按钮时，回退到 **"Start all waiting jobs"** 及其确认对话框
3. 仅当旧对话框无法完成时，才尝试既有 DOM 回退策略：程序化表单提交，或使用页面 CSRF token 发起同源 POST

三种方式都依赖你已有的浏览器会话 cookie——不需要 API token。

## 开发

### 前置条件

- [Node.js](https://nodejs.org/) >= 18.12
- Corepack（随受支持的 Node.js 版本提供）

### 安装依赖

```bash
corepack enable
yarn install
```

### 构建

```bash
yarn build        # 同时构建 dev 和压缩版
yarn build:dev    # 仅 dev
yarn build:prod   # 仅压缩版
```

### Watch 模式

```bash
yarn start            # 提供本地 userscript，直接在 GitHub 页面调试
yarn dev              # yarn start 的别名
yarn dev:build        # 改动时重新构建开发版 userscript
yarn dev:all          # 改动时同时重新构建两份
yarn preview:ui       # 本地 UI 预览（设置对话框、运行面板）：http://127.0.0.1:5173
```

要直接在 GitHub 页面调试，运行 `yarn start` 后，首次打开并安装本地开发脚本：
[http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js](http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js)。
之后修改源码并刷新匹配的 GitHub 页面即可生效。

### 项目结构

```
src/
  main.ts              ← 入口 —— 串联模块、页面检测、生命周期
  core/
    report.ts          ← 报告数据模型 + Markdown 导出（core）
    config.ts          ← 持久化配置（interval、saveLog 提示、panelVisible、homeDashboard、organizations）
    state.ts           ← 运行时状态类型 + 看门狗常量
    log-store.ts       ← 始终开启的日志持久化（批量缓冲、防抖写盘）
    session.ts         ← 跨刷新的 session 持久化
    scheduler.ts       ← 基于 Web Worker 的定时器（规避后台标签页节流）
    pull-requests.ts   ← 基于已登录 GitHub HTML 的 PR 查询
    github.ts          ← 同源请求工具：页面内嵌 JSON、page_data JSON、SSO 链接
    repo-search.ts     ← 组织仓库搜索
    organizations.ts   ← 搜索哪些组织（设置 → GitHub 内嵌列表 → 账号切换器 → SSO 列表）
    favorites.ts       ← 常用仓库（GM 存储）
    sso.ts             ← 未授权 SSO 的组织
    storage-cleanup.ts ← 14 天清理 run 级存储
    version-check.ts   ← 与最新 GitHub Release 比对，结果缓存
  api/
    skip-timers.ts     ← MutationObserver + 3 种 DOM 点击策略
  ui/
    styles.ts          ← 通过 GM_addStyle 注入编译后的 Sass
    styles.scss        ← Sass 入口；分模块样式位于 styles/（tokens、components、panel、settings、dashboard）
    settings.ts        ← 顶部设置入口 + 设置对话框
    ui.ts              ← 面板构建、渲染、事件绑定、报告渲染
    dashboard/         ← 工作面板：dashboard.ts（挂载）、pr-card、favorites-card、search-box、chips、sso-notice
  utils/
    helpers.ts         ← ts()、esc()、formatDuration()
    url.ts             ← URL 解析 + Deploy (PRD) 页面检测
```

### 构建产物

| 文件 | 说明 |
|------|------|
| `build/auto-approve-deploy.user.js` | 开发版 —— 未压缩，可读（gitignored）|
| `build/auto-approve-deploy.min.user.js` | 生产版 —— JS 压缩 + CSS/HTML 模板压缩（gitignored）|

### 发布流程

本地：`yarn release patch`（release-it）升版本号、构建、提交、打 tag。然后 `git push --follow-tags origin main` 触发 `.github/workflows/release.yml`，自动创建 GitHub Release 并上传两份 `.user.js` 产物。完整流程见 `.agents/skills/release/SKILL.md`。

## License

MIT
