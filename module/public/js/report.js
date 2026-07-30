async function api(path, opts) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) throw new Error('Request failed: ' + res.status);
  return res.json();
}

async function populateDropdowns() {
  const [schools, departments] = await Promise.all([
    api('/schools'),
    api('/schools/departments')
  ]);

  const schoolSelect = document.getElementById('school');
  schools.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.name || s.code;
    opt.textContent = `${s.name || s.code} - ${s.code}`;
    schoolSelect.appendChild(opt);
  });

  const deptSelect = document.getElementById('department');
  departments.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    deptSelect.appendChild(opt);
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

  const payload = {
    timestamp: new Date().toISOString(),
    submitterEmail: form.submitterEmail.value.trim(),
    school: form.school.value,
    dateOfIncident: form.dateOfIncident.value,
    location: form.location.value,
    department: form.department.value,
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
