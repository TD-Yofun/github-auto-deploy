/**
 * Freeze the page behind a modal. Reference-counted so stacked modals cannot unlock each other.
 * `overflow: hidden` removes the scrollbar, so its width is added as padding to avoid a layout jump.
 */
let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

export function lockScroll(): void {
  if (locks++ > 0) return;
  const root = document.documentElement;
  const scrollbar = window.innerWidth - root.clientWidth;
  saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
  root.style.overflow = 'hidden';
  if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
}

function restore(): void {
  locks = 0;
  if (!saved) return;
  document.documentElement.style.overflow = saved.overflow;
  document.documentElement.style.paddingRight = saved.paddingRight;
  saved = null;
}

export function unlockScroll(): void {
  if (locks === 0 || --locks > 0) return;
  restore();
}

// A Turbo navigation (or bfcache restore) replaces <body>, taking the modal with it without ever
// calling its close handler. Never leave the page frozen in that case.
for (const event of ['turbo:load', 'turbo:render', 'pageshow']) {
  document.addEventListener(event, () => {
    if (locks > 0 && !document.querySelector('.aad-modal-overlay')) restore();
  });
}
