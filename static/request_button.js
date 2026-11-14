/* Keep the control locked for the whole operation, including queued requests. */
(() => {
  'use strict';
  const disabledAfterRequest = new WeakMap();
  const pendingByContainer = new WeakMap();

  function setDisabled(button, disabled) {
    if (disabledAfterRequest.has(button)) disabledAfterRequest.set(button, disabled);
    else button.disabled = disabled;
  }

  function setPending(button, pending) {
    if (pending) {
      disabledAfterRequest.set(button, button.disabled);
      button.disabled = true;
      button.dataset.requestPending = 'true';
      button.setAttribute('aria-busy', 'true');
    } else {
      button.disabled = disabledAfterRequest.get(button) ?? button.disabled;
      disabledAfterRequest.delete(button);
      delete button.dataset.requestPending;
      button.removeAttribute('aria-busy');
    }
  }

  async function run(button, request) {
    if (!button) return request();
    if (button.disabled) return;
    setPending(button, true);
    try {
      return await request();
    } finally {
      setPending(button, false);
    }
  }

  // Preserve pending buttons when a live update redraws their list.
  function replaceContents(container, markup, key) {
    const pending = pendingByContainer.get(container) || new Map();
    for (const [id, button] of pending) {
      if (!disabledAfterRequest.has(button)) pending.delete(id);
    }
    for (const button of container.querySelectorAll('button[data-request-pending]')) {
      pending.set(key(button), button);
    }
    pendingByContainer.set(container, pending);
    if (!pending.size) {
      container.innerHTML = markup;
      return;
    }
    const template = document.createElement('template');
    template.innerHTML = markup;
    for (const replacement of template.content.querySelectorAll('button')) {
      const button = pending.get(key(replacement));
      if (!button) continue;
      for (const attr of replacement.attributes) button.setAttribute(attr.name, attr.value);
      button.innerHTML = replacement.innerHTML;
      replacement.replaceWith(button);
    }
    container.replaceChildren(template.content);
  }

  window.RelayRequestButton = {run, setPending, setDisabled, replaceContents};
})();
