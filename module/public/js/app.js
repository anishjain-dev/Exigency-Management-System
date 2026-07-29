/**
 * app.js
 *
 * Vanilla JS dashboard controller — no framework. Talks to the local
 * Express API only (relative /api/... paths).
 */

const STATUS_COLORS = {
  Open: '#FBBC04', 'In Progress': '#4285F4', Snoozed: '#A142F4', Closed: '#34A853'
};

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'dashboard') loadDashboard();
    if (btn.dataset.tab === 'exigencies') loadExigencies();
    if (btn.dataset.tab === 'schools') loadSchools();
    if (btn.dataset.tab === 'settings') loadSettings();
    if (btn.dataset.tab === 'logs') loadLogs();
  });
});

async function api(path, options) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function loadDashboard() {
  const { kpis, schoolCounts } = await api('/dashboard');
  const grid = document.getElementById('kpiGrid');
  grid.innerHTML = [
    ['Total', kpis.total], ['Open', kpis.open], ['Closed', kpis.closed],
    ['Pending', kpis.pending], ["Today's Follow-ups", kpis.todayFollowups], ['Overdue', kpis.overdue]
  ].map(([label, value]) => `
    <div class="kpi-card"><div class="value">${value}</div><div class="label">${label}</div></div>
  `).join('');

  document.querySelector('#schoolCountsTable tbody').innerHTML = schoolCounts.map((s) => `
    <tr><td>${s.school}</td><td>${s.total}</td><td>${s.open}</td><td>${s.closed}</td></tr>
  `).join('');
}

document.getElementById('runReminderBtn').addEventListener('click', async () => {
  const el = document.getElementById('reminderResult');
  el.textContent = 'Running...';
  try {
    const result = await api('/reminders/run-now', { method: 'POST' });
    el.textContent = `Sent: ${result.sent}, skipped: ${result.skipped}`;
    loadDashboard();
  } catch (e) {
    el.textContent = 'Error: ' + e.message;
  }
});

async function loadExigencies() {
  const school = document.getElementById('filterSchool').value;
  const status = document.getElementById('filterStatus').value;
  const params = new URLSearchParams();
  if (school) params.set('school', school);
  if (status) params.set('status', status);

  const rows = await api('/exigencies?' + params.toString());
  document.querySelector('#exigenciesTable tbody').innerHTML = rows.map((r) => `
    <tr data-id="${r.id}">
      <td>${r.id}</td>
      <td>${r.school_code}</td>
      <td>${(r.issue || '').slice(0, 40)}</td>
      <td><input class="edit-owner" value="${r.owner || ''}" /></td>
      <td><input class="edit-followup" type="date" value="${r.followup_date ? r.followup_date.slice(0,10) : ''}" /></td>
      <td>
        <select class="edit-status">
          ${['Open','In Progress','Snoozed','Closed'].map((s) => `<option ${s===r.status?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><input class="edit-nextdue" type="date" value="${r.next_due_date ? r.next_due_date.slice(0,10) : ''}" /></td>
      <td>${fmtDate(r.closed_date)}</td>
      <td><button class="save-row-btn">Save</button></td>
    </tr>
  `).join('');

  document.querySelectorAll('.save-row-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const id = tr.dataset.id;
      const payload = {
        owner: tr.querySelector('.edit-owner').value,
        followup_date: tr.querySelector('.edit-followup').value || null,
        status: tr.querySelector('.edit-status').value,
        next_due_date: tr.querySelector('.edit-nextdue').value || null
      };
      await api(`/exigencies/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      loadExigencies();
    });
  });
}

document.getElementById('refreshExigenciesBtn').addEventListener('click', loadExigencies);
document.getElementById('filterSchool').addEventListener('change', loadExigencies);
document.getElementById('filterStatus').addEventListener('change', loadExigencies);

async function loadSchools() {
  const schools = await api('/schools');

  const filterSelect = document.getElementById('filterSchool');
  filterSelect.innerHTML = '<option value="">All Schools</option>' +
    schools.map((s) => `<option value="${s.code}">${s.code} - ${s.name}</option>`).join('');

  document.getElementById('schoolsList').innerHTML = schools.map((s) => `
    <div class="school-card">
      <h3>${s.code} — ${s.name}</h3>
      <table class="data-table">
        <thead><tr><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead>
        <tbody>
          ${s.users.map((u) => `
            <tr>
              <td>${u.email}</td><td>${u.role}</td><td>${u.active ? 'Yes' : 'No'}</td>
              <td><button class="remove-user-btn" data-id="${u.id}">Remove</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <form class="inline-form add-user-form" data-code="${s.code}">
        <input type="email" placeholder="user@example.org" required class="user-email" />
        <input placeholder="Role (optional)" class="user-role" />
        <button type="submit">Add User</button>
      </form>
    </div>
  `).join('');

  document.querySelectorAll('.remove-user-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      await api(`/schools/users/${e.target.dataset.id}`, { method: 'DELETE' });
      loadSchools();
    });
  });

  document.querySelectorAll('.add-user-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = form.dataset.code;
      const email = form.querySelector('.user-email').value;
      const role = form.querySelector('.user-role').value;
      await api(`/schools/${code}/users`, { method: 'POST', body: JSON.stringify({ email, role, active: true }) });
      loadSchools();
    });
  });
}

document.getElementById('addSchoolForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('newSchoolCode').value;
  const name = document.getElementById('newSchoolName').value;
  await api('/schools', { method: 'POST', body: JSON.stringify({ code, name }) });
  document.getElementById('addSchoolForm').reset();
  loadSchools();
});

const SETTINGS_FIELDS = [
  'AdminEmail', 'DefaultCC', 'OrgDomain', 'FsGroupEmail',
  'StatusList', 'ClosedStatus', 'ReminderTriggerHour', 'DashboardTriggerHour'
];

async function loadSettings() {
  const settings = await api('/settings');
  const form = document.getElementById('settingsForm');
  form.innerHTML = SETTINGS_FIELDS.map((key) => `
    <label for="setting-${key}">${key}</label>
    <input id="setting-${key}" name="${key}" value="${settings[key] || ''}" />
  `).join('');
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const payload = {};
  SETTINGS_FIELDS.forEach((key) => {
    const el = document.getElementById('setting-' + key);
    if (el) payload[key] = el.value;
  });
  await api('/settings', { method: 'PUT', body: JSON.stringify(payload) });
  document.getElementById('settingsSaved').textContent = 'Saved (restart server to apply new reminder hour).';
  setTimeout(() => { document.getElementById('settingsSaved').textContent = ''; }, 4000);
});

async function loadLogs() {
  const logs = await api('/logs?limit=200');
  document.querySelector('#logsTable tbody').innerHTML = logs.map((l) => `
    <tr>
      <td>${new Date(l.timestamp).toLocaleString()}</td>
      <td>${l.record_id || ''}</td>
      <td>${l.recipient || ''}</td>
      <td>${l.type || ''}</td>
      <td>${l.status || ''}</td>
      <td>${l.message || ''}</td>
    </tr>
  `).join('');
}

// Initial load.
loadSchools().then(loadDashboard);
