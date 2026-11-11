/** "Update required" notice, shared by the run panel and the settings dialog. */
import { INSTALL_URL, type VersionCheckResult } from '../core/version-check';
import { esc } from '../utils/helpers';

export function renderUpdateNotice(v: VersionCheckResult): string {
  const notes = v.releaseNotes
    ? `<details open class="aad-version-notes"><summary class="aad-version-notes-summary">📋 v${esc(v.latest)} 更新内容</summary>
         <div class="aad-version-notes-body">${esc(v.releaseNotes)}</div>
       </details>`
    : '';
  return `<div class="aad-version-error">⛔ 脚本版本过期，请更新后使用</div>
    <div class="aad-version-current">当前: <code>${esc(v.current)}</code> · 最新: <code>${esc(v.latest)}</code></div>
    <div class="aad-version-actions">
      <a href="${esc(INSTALL_URL)}" target="_blank" rel="noopener" class="aad-version-install">📥 安装最新版本</a>
      <a href="${esc(v.releaseUrl)}" target="_blank" rel="noopener" class="aad-version-release">查看 Release 页</a>
    </div>
    ${notes}`;
}
