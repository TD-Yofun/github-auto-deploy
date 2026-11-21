import { ssoAuthorizeUrl } from '../../core/github';
import type { SsoOrganization } from '../../core/sso';
import { esc } from '../../utils/helpers';
import { ICON_LOCK } from '../icons';

/** Banner explaining why organization data is hidden, with one authorize link per organization. */
export function renderSsoNotice(organizations: SsoOrganization[], compact = false): string {
  if (organizations.length === 0) return '';
  const links = organizations
    .map((o) => `<a class="aad-btn aad-btn--sm" href="${esc(ssoAuthorizeUrl(o.login))}">Authorize ${esc(o.name)}</a>`)
    .join('');
  const names = organizations.map((o) => esc(o.name)).join(', ');
  return `<div class="aad-sso${compact ? ' aad-sso--compact' : ''}" role="status">
    <span class="aad-sso-icon">${ICON_LOCK}</span>
    <div class="aad-sso-text"><strong>Single sign-on required</strong>
      <span>Private repositories and pull requests of ${names} stay hidden until you authorize SSO for this session.</span></div>
    <div class="aad-sso-actions">${links}</div>
  </div>`;
}
