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

/**
 * A plain radio-button group, matching how the original Google Form
 * renders its "Choose the Department" question.
 */
function createRadioGroup({ groupId, name, items }) {
  const box = document.getElementById(groupId);
  box.innerHTML = items.map((item) => `
    <label class="radio-option">
      <input type="radio" name="${name}" value="${item.value.replace(/"/g, '&quot;')}" />
      ${item.label}
    </label>
  `).join('');

  const inputs = () => Array.from(box.querySelectorAll('input[type="radio"]'));

  inputs().forEach((input) => {
    input.addEventListener('change', () => box.classList.remove('invalid'));
  });

  return {
    getValue: () => {
      const checked = inputs().find((i) => i.checked);
      return checked ? checked.value : '';
    },
    reset: () => {
      inputs().forEach((i) => { i.checked = false; });
      box.classList.remove('invalid');
    },
    markInvalid: () => box.classList.add('invalid')
  };
}

let schoolSelect;
let departmentGroup;

const DEPARTMENT_ORDER = [
  'Student Safety / Medical Emergency',
  'Transport',
  'Kitchen',
  'Events',
  'Infrastructure/Safety',
  'Animal/Reptile Issue',
  'Staff Safety & Conduct',
  'Other'
];

/**
 * "Other" always sorts last, and any custom department not in
 * DEPARTMENT_ORDER (indexOf === -1) sorts after the known ones instead of
 * before them (plain indexOf-difference would put unknowns first, since
 * -1 - -1 = 0 ties with the unknown's real neighbors but -1 < any real index).
 */
function compareDepartments(a, b) {
  if (/^others?$/i.test(a)) return 1;
  if (/^others?$/i.test(b)) return -1;
  const ai = DEPARTMENT_ORDER.indexOf(a);
  const bi = DEPARTMENT_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

async function populateDropdowns() {
  const [schools, departmentsRaw] = await Promise.all([
    api('/schools'),
    api('/schools/departments')
  ]);
  const departments = departmentsRaw.slice().sort(compareDepartments);

  schoolSelect = createCustomSelect({
    triggerId: 'schoolTrigger',
    optionsId: 'schoolOptions',
    placeholder: 'Select school…',
    items: schools.map((s) => {
      const name = s.name || s.code;
      const alreadyLabeled = name.toUpperCase().indexOf(s.code.toUpperCase()) !== -1;
      return { value: name, label: alreadyLabeled ? name : `${name} - ${s.code}` };
    })
  });

  departmentGroup = createRadioGroup({
    groupId: 'departmentOptions',
    name: 'department',
    items: departments.map((d) => ({ value: d, label: d }))
  });
}

const REMEMBERED_EMAIL_KEY = 'exigency.rememberedEmail';

function loadRememberedEmail() {
  const fromUrl = new URLSearchParams(window.location.search).get('email');
  const saved = fromUrl || localStorage.getItem(REMEMBERED_EMAIL_KEY);
  if (saved) document.getElementById('submitterEmail').value = saved;
}

function saveRememberedEmail(email) {
  if (email) localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
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
  const department = departmentGroup.getValue();

  if (!school || !department) {
    if (!school) schoolSelect.markInvalid();
    if (!department) departmentGroup.markInvalid();
    msg.textContent = 'Please select a school and department.';
    msg.className = 'form-message error';
    return;
  }

  submitBtn.disabled = true;
  msg.textContent = 'Submitting…';
  msg.className = 'form-message';

  try {
    let attachments = '';
    const files = form.attachments.files;
    if (files && files.length) {
      const batchId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, '');
      const fd = new FormData();
      fd.append('batchId', batchId);
      Array.from(files).forEach((f) => fd.append('files', f));
      const uploadRes = await fetch('/api/report/upload', { method: 'POST', body: fd });
      if (!uploadRes.ok) throw new Error('File upload failed: ' + uploadRes.status);
      const uploaded = await uploadRes.json();
      attachments = uploaded.galleryUrl || '';
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
      attachments,
      immediateActions: form.immediateActions.value,
      resolved: form.resolved.value,
      closureDate: form.closureDate.value || null,
      suggestedChanges: form.suggestedChanges.value
    };

    const result = await api('/report/submit', { method: 'POST', body: JSON.stringify(payload) });
    if (result.accepted) {
      msg.textContent = `Submitted — Form Number ${result.id}. The concerned department has been notified.`;
      msg.className = 'form-message success';
      saveRememberedEmail(payload.submitterEmail);
      form.reset();
      schoolSelect.reset();
      departmentGroup.reset();
      toggleClosureDate();
      loadRememberedEmail();
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
loadRememberedEmail();
