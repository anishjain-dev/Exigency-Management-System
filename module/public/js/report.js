async function api(path, opts) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) throw new Error('Request failed: ' + res.status);
  return res.json();
}

/**
 * A native <select> always shows the currently-selected value twice — once
 * as the closed control's label, once highlighted at the top of the open
 * list. This builds a small custom dropdown instead (closer to how Google
 * Forms renders its own dropdowns) so the value only ever appears once.
 */
function createCustomSelect({ triggerId, optionsId, placeholder, items }) {
  const trigger = document.getElementById(triggerId);
  const optionsBox = document.getElementById(optionsId);
  let value = '';

  optionsBox.innerHTML = items.map((item) => `
    <div class="custom-select-option" data-value="${item.value.replace(/"/g, '&quot;')}" role="option">${item.label}</div>
  `).join('');

  function close() {
    optionsBox.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function open() {
    document.querySelectorAll('.custom-select-options').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('.custom-select-trigger').forEach((el) => el.setAttribute('aria-expanded', 'false'));
    optionsBox.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  trigger.addEventListener('click', () => {
    if (optionsBox.hidden) open(); else close();
  });

  optionsBox.querySelectorAll('.custom-select-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      value = opt.dataset.value;
      trigger.textContent = opt.textContent;
      trigger.classList.add('has-value');
      trigger.classList.remove('invalid');
      optionsBox.querySelectorAll('.custom-select-option').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      close();
    });
  });

  document.addEventListener('click', (e) => {
    if (!trigger.contains(e.target) && !optionsBox.contains(e.target)) close();
  });

  return {
    getValue: () => value,
    reset: () => {
      value = '';
      trigger.textContent = placeholder;
      trigger.classList.remove('has-value', 'invalid');
      optionsBox.querySelectorAll('.custom-select-option').forEach((o) => o.classList.remove('selected'));
    },
    markInvalid: () => trigger.classList.add('invalid')
  };
}

let schoolSelect;
let departmentSelect;

async function populateDropdowns() {
  const [schools, departments] = await Promise.all([
    api('/schools'),
    api('/schools/departments')
  ]);

  schoolSelect = createCustomSelect({
    triggerId: 'schoolTrigger',
    optionsId: 'schoolOptions',
    placeholder: 'Select school…',
    items: schools.map((s) => ({ value: s.name || s.code, label: `${s.name || s.code} - ${s.code}` }))
  });

  departmentSelect = createCustomSelect({
    triggerId: 'departmentTrigger',
    optionsId: 'departmentOptions',
    placeholder: 'Select department…',
    items: departments.map((d) => ({ value: d, label: d }))
  });
}

function toggleClosureDate() {
  const resolved = document.getElementById('resolved').value;
  document.getElementById('closureDateField').style.display = resolved === 'Yes' ? 'none' : 'flex';
}

document.getElementById('resolved').addEventListener('change', toggleClosureDate);

document.getElementById('reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('submitBtn');
  const msg = document.getElementById('formMessage');

  const school = schoolSelect.getValue();
  const department = departmentSelect.getValue();

  if (!school || !department) {
    if (!school) schoolSelect.markInvalid();
    if (!department) departmentSelect.markInvalid();
    msg.textContent = 'Please select a school and department.';
    msg.className = 'form-message error';
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    submitterEmail: form.submitterEmail.value.trim(),
    school,
    dateOfIncident: form.dateOfIncident.value,
    location: form.location.value,
    department,
    critical: form.critical.value,
    issue: form.issue.value,
    attachments: form.attachments.value,
    immediateActions: form.immediateActions.value,
    resolved: form.resolved.value,
    closureDate: form.closureDate.value || null,
    suggestedChanges: form.suggestedChanges.value
  };

  submitBtn.disabled = true;
  msg.textContent = 'Submitting…';
  msg.className = 'form-message';

  try {
    const result = await api('/report/submit', { method: 'POST', body: JSON.stringify(payload) });
    if (result.accepted) {
      msg.textContent = `Submitted — Form Number ${result.id}. The concerned department has been notified.`;
      msg.className = 'form-message success';
      form.reset();
      schoolSelect.reset();
      departmentSelect.reset();
      toggleClosureDate();
    } else {
      msg.textContent = result.reason || 'Submission was not accepted.';
      msg.className = 'form-message error';
    }
  } catch (err) {
    msg.textContent = 'Something went wrong: ' + err.message;
    msg.className = 'form-message error';
  } finally {
    submitBtn.disabled = false;
  }
});

populateDropdowns();
toggleClosureDate();
