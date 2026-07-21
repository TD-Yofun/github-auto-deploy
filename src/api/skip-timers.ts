/**
 * Deployment approval — DOM-based dialog automation + MutationObserver
 */
type LogFn = (msg: string, level?: string) => void;

export interface DeploymentTrigger {
  button: HTMLElement;
  label: 'Review deployments' | 'Start all waiting jobs';
  isReviewDeployments: boolean;
}

const REVIEW_DEPLOYMENTS_SELECTOR =
  'form[action*="/environments/approve_or_reject"] button[data-show-dialog-id]';
const REVIEW_DEPLOYMENTS_RE = /^review deployments$/i;
const START_ALL_WAITING_JOBS_RE = /start all waiting/i;

/** Finds GitHub's current deployment review control before the legacy control. */
export function findDeploymentTrigger(): DeploymentTrigger | null {
  const reviewButton = document.querySelector<HTMLElement>(REVIEW_DEPLOYMENTS_SELECTOR);
  if (reviewButton && REVIEW_DEPLOYMENTS_RE.test((reviewButton.textContent || '').trim())) {
    return {
      button: reviewButton,
      label: 'Review deployments',
      isReviewDeployments: true,
    };
  }

  const candidates = document.querySelectorAll<HTMLElement>(
    'button, [role="button"], summary, a.btn'
  );
  for (const button of candidates) {
    if (START_ALL_WAITING_JOBS_RE.test(button.textContent || '')) {
      return {
        button,
        label: 'Start all waiting jobs',
        isReviewDeployments: false,
      };
    }
  }
  return null;
}

function findApproveButton(dialog: HTMLElement): HTMLButtonElement | null {
  return dialog.querySelector<HTMLButtonElement>(
    'button[name="decision"][value="approved"], button.js-gates-approval-dialog-approve-button, button[data-target="break-glass-deployments"]'
  );
}

async function waitForEnabledApproveButton(dialog: HTMLElement): Promise<HTMLButtonElement | null> {
  for (let i = 0; i < 10; i++) {
    const button = findApproveButton(dialog);
    if (button && !button.disabled) return button;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Observe DOM for deployment approval controls. "Review deployments" takes
 * precedence over the legacy "Start all waiting jobs" button.
 * Fires `onDetected` immediately when the button is found (either already
 * present or dynamically added).  Returns a disconnect function.
 */
export function observeSkipButton(onDetected: () => void): () => void {
  // Scan the whole document for the button. Cheap (~few ms) and avoids
  // missing late insertions inside already-existing containers that don't
  // bubble up as top-level addedNodes.
  const scanDocument = (): boolean => !!findDeploymentTrigger();

  let fired = false;
  const tryFire = () => {
    if (scanDocument()) {
      if (fired) return; // already fired this batch
      fired = true;
      onDetected();
      // Reset so next appearance (e.g., next environment gate) can re-fire,
      // after a short debounce window. handleSkipDetected has its own
      // skipInProgress + cooldown guards for re-entry protection.
      setTimeout(() => { fired = false; }, 1000);
    }
  };

  const observer = new MutationObserver(() => {
    // Any DOM change → re-scan. Cheap and reliable.
    tryFire();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Check if button already exists in the current DOM
  tryFire();

  return () => observer.disconnect();
}

export async function trySkipWaitTimers(owner: string, repo: string, addLog: LogFn, skipInitialDelay = false): Promise<boolean> {
  try {
    await new Promise((r) => setTimeout(r, skipInitialDelay ? 300 : 2000));

    // DEBUG: dump relevant DOM elements
    const allForms = [...document.querySelectorAll('form')];
    const skipForms = allForms.filter((f) => {
      const a = f.getAttribute('action') || '';
      return a.includes('environment') || a.includes('skip');
    });
    addLog(`[skip-debug] Forms total: ${allForms.length}, skip-related: ${skipForms.length}`);
    skipForms.forEach((f) =>
      addLog(`[skip-debug]   form action="${f.getAttribute('action')}"`)
    );

    const allBtns = [...document.querySelectorAll<HTMLElement>('button, [role="button"], summary, a.btn')];
    const relevantBtns = allBtns.filter((b) =>
      /start|skip|waiting|timer|deploy|approve|consequence/i.test(b.textContent || '')
    );
    addLog(`[skip-debug] Relevant buttons: ${relevantBtns.length}`);
    relevantBtns.forEach((b) =>
      addLog(`[skip-debug]   <${b.tagName.toLowerCase()}> "${(b.textContent || '').trim().slice(0, 80)}"`)
    );

    const gateInputs = document.querySelectorAll<HTMLInputElement>('input[name="gate_request[]"]');
    addLog(`[skip-debug] gate_request[] inputs: ${gateInputs.length}`);
    gateInputs.forEach((i) => addLog(`[skip-debug]   value="${i.value}"`));

    // Approach 1: prefer GitHub's current "Review deployments" control, then
    // fall back to the legacy "Start all waiting jobs" control.
    const trigger = findDeploymentTrigger();
    if (trigger) {
      addLog(`[skip] Approach 1: clicking "${trigger.label}"`);
      trigger.button.click();

      let dialog: HTMLElement | null = null;
      for (let i = 0; i < 10; i++) {
        dialog = document.querySelector('#gates-break-glass-dialog[open], dialog[open].js-gates-dialog');
        if (dialog) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      if (!dialog) {
        addLog('[skip] Approach 1: dialog did not appear after clicking button', 'warn');
        if (trigger.isReviewDeployments) return false;
      } else {
        addLog(`[skip]   dialog found: #${dialog.id}`);

        const checkboxes = dialog.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"][name="gate_request[]"], input.js-gates-dialog-environment-checkbox'
        );
        addLog(`[skip]   checkboxes found: ${checkboxes.length}`);
        checkboxes.forEach((cb) => {
          if (!cb.checked) {
            cb.click();
            addLog(`[skip]   checked: ${cb.value} (${cb.id})`);
          } else {
            addLog(`[skip]   already checked: ${cb.value}`);
          }
        });

        if (checkboxes.length === 0) {
          addLog('[skip] Approach 1: no checkboxes found in dialog', 'warn');
          if (trigger.isReviewDeployments) return false;
        } else {
          const submitBtn = await waitForEnabledApproveButton(dialog);
          if (submitBtn) {
            const st = (submitBtn.textContent || '').trim();
            addLog(`[skip]   clicking approve: "${st.slice(0, 60)}"`, 'ok');
            submitBtn.click();
            await new Promise((r) => setTimeout(r, 3000));
            return true;
          }

          addLog('[skip] Approach 1: approve button did not become enabled', 'warn');
          if (trigger.isReviewDeployments) return false;
        }
      }
    }

    // Approach 2: submit skip form WITH gate_request[] appended
    for (const form of skipForms) {
      const action = form.getAttribute('action') || '';
      if (action.endsWith('/skip')) {
        addLog(`[skip] Approach 2: submitting form → ${action}`);
        const formData = new FormData(form);

        let addedGates = 0;
        if (!formData.has('gate_request[]')) {
          gateInputs.forEach((i) => {
            formData.append('gate_request[]', i.value);
            addedGates++;
          });
        }
        addLog(`[skip]   form fields: ${[...formData.keys()].join(', ')} (added ${addedGates} gate_request from DOM)`);

        if (!formData.has('gate_request[]')) {
          addLog(`[skip] Approach 2: no gate_request[] — skipping`, 'warn');
          continue;
        }

        const resp = await fetch(action, {
          method: 'POST',
          body: new URLSearchParams(formData as unknown as Record<string, string>),
          credentials: 'same-origin',
          redirect: 'follow',
        });
        addLog(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
        if (resp.ok || resp.redirected) {
          addLog(`[skip] Approach 2: form submitted OK`, 'ok');
          return true;
        }
        addLog(`[skip] Approach 2: form submit failed (${resp.status})`, 'warn');
      }
    }

    // Approach 3: manual POST from CSRF in form + gate_request[]
    const csrfInput = skipForms.length > 0
      ? skipForms[0].querySelector<HTMLInputElement>('input[name="authenticity_token"]')
      : null;
    if (csrfInput && gateInputs.length > 0) {
      const csrf = csrfInput.value;
      addLog(`[skip] Approach 3: manual POST with CSRF from form + ${gateInputs.length} gate(s)`);

      const body = new URLSearchParams();
      body.append('authenticity_token', csrf);
      body.append('comment', 'Auto-skipped by Auto-Approve Deploy Gates');
      gateInputs.forEach((i) => body.append('gate_request[]', i.value));

      const skipUrl = `/${owner}/${repo}/environments/skip`;
      addLog(`[skip]   POST → ${skipUrl}`);
      const resp = await fetch(skipUrl, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        redirect: 'follow',
      });
      addLog(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
      if (resp.ok || resp.redirected) {
        addLog(`[skip] Approach 3: POST succeeded`, 'ok');
        return true;
      }
      addLog(`[skip] Approach 3: POST failed (${resp.status})`, 'warn');
    }

    addLog('[skip] All approaches exhausted — no skip controls found', 'warn');
    return false;
  } catch (e) {
    addLog(`[skip] Error: ${(e as Error).message}`, 'warn');
    return false;
  }
}
