// A small in-app question with two or three answers. Native dialogs are unreliable in embedded browsers, so this
// is what the app uses when it has to ask before something is lost.
const $ = (s) => document.querySelector(s);
let open = null;

export function ask({ title, message, buttons }) {
  return new Promise((resolve) => {
    if (open) open('cancel');
    const box = $('#dialog'), t = $('#dialog-title'), m = $('#dialog-message'), row = $('#dialog-buttons');
    t.textContent = title; m.textContent = message || ''; row.innerHTML = '';
    const finish = (v) => { open = null; box.hidden = true; window.removeEventListener('keydown', onKey, true); resolve(v); };
    open = finish;
    for (const b of buttons) {
      const el = document.createElement('button'); el.type = 'button';
      el.className = `btn ${b.kind || ''}`; el.textContent = b.label;
      el.addEventListener('click', () => finish(b.value));
      row.appendChild(el);
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(buttons.find((b) => b.value === 'cancel') ? 'cancel' : buttons[buttons.length - 1].value); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const d = buttons.find((b) => b.kind === 'primary') || buttons[0]; finish(d.value); }
    };
    window.addEventListener('keydown', onKey, true);
    box.hidden = false;
    requestAnimationFrame(() => row.querySelector('.btn.primary, .btn')?.focus());
  });
}

// The usual "Save changes?" question. Resolves 'save', 'discard' or 'cancel'.
export const askSave = (name) => ask({
  title: `Save changes to "${name}"?`,
  message: 'Your changes will be lost if you don’t save them.',
  buttons: [{ label: 'Save', kind: 'primary', value: 'save' }, { label: 'Don’t save', kind: 'danger', value: 'discard' }, { label: 'Cancel', value: 'cancel' }],
});
