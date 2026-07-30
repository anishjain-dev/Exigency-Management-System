/**
 * app.js
 *
 * Vanilla JS dashboard controller — no framework. Talks to the local
 * Express API only (relative /api/... paths).
 */

const TAB_TITLES = {
  dashboard: 'Dashboard',
  exigencies: 'Exigencies',
  schools: 'Schools & Recipients',
  settings: 'Settings',
  logs: 'Logs'
};

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    document.getElementById('pageTitle').textContent = TAB_TITLES[btn.dataset.tab] || '';
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

const KPI_DEFS = [
  { key: 'total', label: 'Total' },
  { key: 'unresolved', label: 'Unresolved', accent: 'accent-warning' },
  { key: 'resolved', label: 'Resolved', accent: 'accent-success' },
  { key: 'critical', label: 'Critical', accent: 'accent-critical' },
  { key: 'dueToday', label: 'Due Today', accent: 'accent-warning' },
  { key: 'overdue', label: 'Overdue', accent: 'accent-critical' }
];

async function loadDashboard() {
  const { kpis, schoolCounts, departmentCounts } = await api('/dashboard');

  document.getElementById('kpiGrid').innerHTML = KPI_DEFS.map((def) => `
    <div class="kpi-card ${def.accent || ''}">
      <div class="value">${kpis[def.key] ?? 0}</div>
      <div class="label">${def.label}</div>
    </div>
  `).join('');

  renderBarList('schoolBars', schoolCounts, 'school');
  renderBarList('departmentBars', departmentCounts, 'department');
}

/**
 * Renders a compact horizontal stacked bar (unresolved + resolved) per row,
 * scaled against the largest total in the set.
 */
function renderBarList(containerId, rows, labelKey) {
  const container = document.getElementById(containerId);
  if (!rows.length) {
    container.innerHTML = '<div class="bar-empty">No data yet.</div>';
    return;
  }
  const maxTotal = Math.max(...rows.map((r) => r.total), 1);
  container.innerHTML = rows.map((r) => {
    const unresolvedPct = (r.unresolved / maxTotal) * 100;
    const resolvedPct = (r.resolved / maxTotal) * 100;
    return `
      <div class="bar-row">
        <div class="bar-label" title="${r[labelKey]}">${r[labelKey]}</div>
        <div class="bar-track">
          <div class="bar-fill-unresolved" style="width:${unresolvedPct}%"></div>
          <div class="bar-fill-resolved" style="width:${resolvedPct}%"></div>
        </div>
        <div class="bar-total">${r.total}</div>
      </div>`;
  }).join('');
}

document.getElementById('runReminderBtn').addEventListener('click', async () => {
  const el = document.getElementById('reminderResult');
  if (!confirm('This will send real reminder emails to recipients now. Continue?')) {
    return;
  }
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
  const department = document.getElementById('filterDepartment').value;
  const resolved = document.getElementById('filterResolved').value;
  const params = new URLSearchParams();
  if (school) params.set('school', school);
  if (department) params.set('department', department);
  if (resolved) params.set('resolved', resolved);

  const rows = await api('/exigencies?' + params.toString());
  const tbody = document.querySelector('#exigenciesTable tbody');
  const emptyState = document.getElementById('exigenciesEmpty');

  emptyState.hidden = rows.length !== 0;
  tbody.innerHTML = rows.map((r) => `
    <tr data-id="${r.id}">
      <td>${r.id}</td>
      <td>${r.school_code}</td>
      <td>${r.department || ''}</td>
      <td>${r.critical ? '<span class="status-pill pill-critical">CRITICAL</span>' : '<span class="status-pill pill-muted">No</span>'}</td>
      <td title="${(r.issue || '').replace(/"/g, '&quot;')}">${(r.issue || '').slice(0, 40)}</td>
      <td>${r.location || ''}</td>
      <td><input class="edit-actions" value="${(r.immediate_actions || '').replace(/"/g, '&quot;')}" /></td>
      <td>
        <select class="edit-resolved">
          <option value="No" ${r.resolved !== 'Yes' ? 'selected' : ''}>No</option>
          <option value="Yes" ${r.resolved === 'Yes' ? 'selected' : ''}>Yes</option>
        </select>
      </td>
      <td><input class="edit-closure" type="date" value="${r.closure_date ? r.closure_date.slice(0,10) : ''}" /></td>
      <td><button class="save-row-btn">Save</button></td>
    </tr>
  `).join('');

  document.querySelectorAll('.save-row-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const id = tr.dataset.id;
      const payload = {
        immediate_actions: tr.querySelector('.edit-actions').value,
        resolved: tr.querySelector('.edit-resolved').value,
        closure_date: tr.querySelector('.edit-closure').value || null
      };
      await api(`/exigencies/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      loadExigencies();
    });
  });
}

document.getElementById('refreshExigenciesBtn').addEventListener('click', loadExigencies);
document.getElementById('filterSchool').addEventListener('change', loadExigencies);
document.getElementById('filterDepartment').addEventListener('change', loadExigencies);
document.getElementById('filterResolved').addEventListener('change', loadExigencies);

async function loadSchools() {
  const schools = await api('/schools');
  const departments = await api('/schools/departments');

  const filterSchoolSelect = document.getElementById('filterSchool');
  filterSchoolSelect.innerHTML = '<option value="">All Schools</option>' +
    schools.map((s) => `<option value="${s.code}">${s.code}${s.name && s.name !== s.code ? ' - ' + s.name : ''}</option>`).join('');

  const filterDeptSelect = document.getElementById('filterDepartment');
  filterDeptSelect.innerHTML = '<option value="">All Departments</option>' +
    departments.map((d) => `<option value="${d}">${d}</option>`).join('');

  document.getElementById('schoolsList').innerHTML = schools.map((s) => `
    <div class="school-card">
      <h3>${s.code}${s.name && s.name !== s.code ? ' — ' + s.name : ''}</h3>
      <table class="data-table">
        <thead><tr><th>Department</th><th>To</th><th>CC</th><th></th></tr></thead>
        <tbody>
          ${departments.map((dept) => {
            const existing = (s.departments || []).find((d) => d.department === dept) || { to_emails: '', cc_emails: '' };
            return `
              <tr data-school="${s.code}" data-dept="${dept}">
                <td>${dept}</td>
                <td><input class="recipient-to" value="${existing.to_emails || ''}" placeholder="comma-separated emails" /></td>
                <td><input class="recipient-cc" value="${existing.cc_emails || ''}" placeholder="comma-separated emails" /></td>
                <td><button class="save-recipients-btn">Save</button></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  document.querySelectorAll('.save-recipients-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const to = tr.querySelector('.recipient-to').value;
      const cc = tr.querySelector('.recipient-cc').value;
      await api(`/schools/${encodeURIComponent(tr.dataset.school)}/departments/${encodeURIComponent(tr.dataset.dept)}`, {
        method: 'PUT', body: JSON.stringify({ to, cc })
      });
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
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

document.getElementById('addDeptForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('newDeptName').value;
  await api('/schools/departments', { method: 'POST', body: JSON.stringify({ name }) });
  document.getElementById('addDeptForm').reset();
  loadSchools();
});

const SETTINGS_FIELDS = [
  'MailingEnabled', 'AdminEmail', 'DefaultCC', 'OrgDomain', 'FsGroupEmail', 'ForceRecipientEmail',
  'ReminderTriggerHour', 'DashboardTriggerHour', 'ReminderDelayDays'
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
