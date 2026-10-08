/** Mount extension widgets beside GitHub's dashboard repository navigation. */

const WIDGET_CONTAINER_ID = 'aad-home-sidebar-widgets';

function getLegacyWidgetParent(): HTMLElement | null {
  const details = document.querySelector<HTMLElement>(
    '.dashboard-sidebar loading-context [data-target="loading-context.details"]',
  );
  if (!details) return null;

  return details.querySelector<HTMLElement>(':scope > .tmp-px-4') || details;
}

function getCurrentWidgetParent(): HTMLElement | null {
  const repositoryPartial = document.querySelector<HTMLElement>(
    'react-partial[partial-name="dashboard-repositories"]',
  );
  if (!repositoryPartial || !repositoryPartial.parentElement) return null;

  let container = document.getElementById(WIDGET_CONTAINER_ID) as HTMLElement | null;
  if (!container) {
    container = document.createElement('div');
    container.id = WIDGET_CONTAINER_ID;
  }

  // Keep custom nodes outside React's rendering root so dashboard updates do
  // not overwrite them. Reinsert an existing container after a Turbo update.
  if (container.previousElementSibling !== repositoryPartial) {
    repositoryPartial.insertAdjacentElement('afterend', container);
  }
  return container;
}

/**
 * Creates a widget host on both the legacy and current GitHub home layouts.
 * Returns null while the dashboard sidebar is still loading.
 */
export function getHomeSidebarWidgetHost(widgetId: string): HTMLElement | null {
  const existing = document.getElementById(widgetId) as HTMLElement | null;
  if (existing) return existing;

  const parent = getLegacyWidgetParent() || getCurrentWidgetParent();
  if (!parent) return null;

  const host = document.createElement('section');
  host.id = widgetId;
  parent.append(host);
  return host;
}

/** Remove a widget and its current-layout wrapper once no widgets remain. */
export function removeHomeSidebarWidget(widgetId: string): void {
  document.getElementById(widgetId)?.remove();

  const container = document.getElementById(WIDGET_CONTAINER_ID);
  if (container && container.childElementCount === 0) container.remove();
}
