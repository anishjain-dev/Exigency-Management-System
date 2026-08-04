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
    document.getElementById('sendSelectedReminderBtn').hidden = btn.dataset.tab !== 'exigencies';
    if (btn.dataset.tab === 'dashboard') loadDashboard();
    if (btn.dataset.tab === 'exigencies') loadExigencies();
    if (btn.dataset.tab === 'schools') loadSchools();
    if (btn.dataset.tab === 'settings') loadSettings();
    if (btn.dataset.tab === 'logs') loadLogs();
  });
});

function getAdminToken() {
  return localStorage.getItem('adminToken') || '';
}

async function api(path, options) {
  const token = getAdminToken();
  const res = await fetch('/api' + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
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

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const KPI_DEFS = [
  { key: 'total', label: 'Total' },
  { key: 'unresolved', label: 'Unresolved', accent: 'accent-critical' },
  { key: 'resolved', label: 'Resolved', accent: 'accent-success' },
  { key: 'critical', label: 'Critical', accent: 'accent-warning' },
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
  await loadRecentExigencies();
}

async function loadRecentExigencies() {
  const rows = (await api('/exigencies')).slice(0, 8);
  const tbody = document.querySelector('#recentExigenciesTable tbody');
  const emptyState = document.getElementById('recentExigenciesEmpty');

  emptyState.hidden = rows.length !== 0;
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.id}</td>
      <td>${r.school_code}</td>
      <td>${r.department || ''}</td>
      <td>${r.resolved === 'Yes'
        ? '<span class="status-pill pill-resolved">RESOLVED</span>'
        : '<span class="status-pill pill-not-resolved">NOT RESOLVED</span>'}</td>
    </tr>
  `).join('');
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

document.getElementById('sendSelectedReminderBtn').addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('#exigenciesTable tbody .row-select:checked')).map((cb) => cb.value);
  if (ids.length === 0) {
    alert('Tick at least one exigency first.');
    return;
  }
  if (!confirm(`Send the reminder email right now for ${ids.length} selected exigenc${ids.length > 1 ? 'ies' : 'y'}?`)) return;

  const btn = document.getElementById('sendSelectedReminderBtn');
  btn.disabled = true;
  try {
    const result = await api('/reminders/send-selected', { method: 'POST', body: JSON.stringify({ ids }) });
    alert(`Sent: ${result.sent}, failed: ${result.failed}.`);
  } finally {
    btn.disabled = false;
    loadExigencies();
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

  const openReplyId = document.querySelector('.reply-detail-row:not([hidden])')?.dataset.repliesFor;

  const rows = await api('/exigencies?' + params.toString());
  const tbody = document.querySelector('#exigenciesTable tbody');
  const emptyState = document.getElementById('exigenciesEmpty');

  emptyState.hidden = rows.length !== 0;
  tbody.innerHTML = rows.map((r) => `
    <tr data-id="${r.id}" data-resolved="${r.resolved || 'No'}">
      <td><input type="checkbox" class="row-select" value="${r.id}"></td>
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
      <td class="replies-cell">
        ${r.reply_count > 0
          ? `<button class="view-replies-btn" data-id="${r.id}" title="Click to view the reply">
               <span class="reply-replied-label">Replied${r.reply_count > 1 ? ` (${r.reply_count})` : ''}</span>
               <span class="reply-timestamp">${fmtDateTime(r.last_reply_at)}</span>
             </button>`
          : '<span class="status-pill pill-muted">No reply</span>'}
      </td>
      <td>
        <div class="row-actions">
          <button class="save-row-btn">Save</button>
          ${r.resolved !== 'Yes' ? `<button class="remind-now-btn" data-id="${r.id}" title="Send this exigency's reminder email right now, with an optional custom message">Reminder</button>` : ''}
        </div>
      </td>
    </tr>
    <tr class="reply-detail-row" data-replies-for="${r.id}" hidden><td colspan="12"></td></tr>
  `).join('');

  const selectAllBox = document.getElementById('selectAllExigencies');
  selectAllBox.checked = false;
  selectAllBox.onchange = () => {
    document.querySelectorAll('#exigenciesTable tbody .row-select').forEach((cb) => { cb.checked = selectAllBox.checked; });
  };

  document.querySelectorAll('.save-row-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const id = tr.dataset.id;
      const wasResolved = tr.dataset.resolved === 'Yes';
      const payload = {
        immediate_actions: tr.querySelector('.edit-actions').value,
        resolved: tr.querySelector('.edit-resolved').value,
        closure_date: tr.querySelector('.edit-closure').value || null
      };
      await api(`/exigencies/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

      if (payload.resolved === 'Yes' && !wasResolved) {
        const shouldNotify = confirm(
          'Mark this exigency resolved and email everyone who received the original notification (department recipients + submitter) with the updated status?'
        );
        if (shouldNotify) {
          const result = await api(`/exigencies/${id}/notify-status`, { method: 'POST' });
          alert(result.sent ? 'Update email sent.' : 'Could not send the update email — check Logs for details.');
        }
      }

      loadExigencies();
    });
  });

  document.querySelectorAll('.remind-now-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      const message = prompt(`Add a message to include in the reminder email for ${id} (optional, leave blank for none):`);
      if (message === null) return; // cancelled
      btn.disabled = true;
      try {
        const result = await api(`/exigencies/${id}/remind-now`, { method: 'POST', body: JSON.stringify({ message }) });
        alert(result.sent ? 'Reminder sent.' : 'Could not send the reminder — check Logs for details.');
      } finally {
        loadExigencies();
      }
    });
  });

  document.querySelectorAll('.view-replies-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const detailRow = document.querySelector(`.reply-detail-row[data-replies-for="${btn.dataset.id}"]`);
      if (!detailRow.hidden) { detailRow.hidden = true; return; }

      const replies = await api(`/exigencies/${btn.dataset.id}/replies`);
      detailRow.querySelector('td').innerHTML = '<div class="reply-thread">' + replies.map((rep) => {
        const displayName = rep.from_name || rep.from_email || 'Unknown sender';
        const initials = displayName.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
        return `
        <div class="reply-item">
          <div class="reply-avatar">${initials}</div>
          <div class="reply-content">
            <div class="reply-header">
              <div class="reply-who">
                <span class="reply-name">${displayName}</span>
                ${rep.from_name ? `<span class="reply-email">${rep.from_email}</span>` : ''}
              </div>
              <div class="reply-time">${fmtDateTime(rep.received_at)}</div>
            </div>
            <div class="reply-body">${(rep.body_text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>
          </div>
        </div>`;
      }).join('') + '</div>';
      detailRow.hidden = false;
    });
  });

  if (openReplyId) {
    document.querySelector(`.view-replies-btn[data-id="${openReplyId}"]`)?.click();
  }
}

document.getElementById('refreshExigenciesBtn').addEventListener('click', loadExigencies);
document.getElementById('filterSchool').addEventListener('change', loadExigencies);
document.getElementById('filterDepartment').addEventListener('change', loadExigencies);
document.getElementById('filterResolved').addEventListener('change', loadExigencies);

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

async function loadSchools() {
  const schools = await api('/schools');
  const departments = (await api('/schools/departments')).slice().sort(compareDepartments
  );

  const filterSchoolSelect = document.getElementById('filterSchool');
  filterSchoolSelect.innerHTML = '<option value="">All Schools</option>' +
    schools.map((s) => `<option value="${s.code}">${s.code}${s.name && s.name !== s.code ? ' - ' + s.name : ''}</option>`).join('');

  const filterDeptSelect = document.getElementById('filterDepartment');
  filterDeptSelect.innerHTML = '<option value="">All Departments</option>' +
    departments.map((d) => `<option value="${d}">${d}</option>`).join('');

  document.getElementById('schoolsManageList').innerHTML = schools.length
    ? '<ul class="manage-list-items">' + schools.map((s) => `
        <li>
          <span>${s.code}${s.name && s.name !== s.code ? ' — ' + s.name : ''}</span>
          <span class="manage-list-actions">
            <button class="edit-school-btn" data-code="${s.code}" data-name="${(s.name || '').replace(/"/g, '&quot;')}">Edit</button>
            <button class="delete-school-btn danger" data-code="${s.code}">Delete</button>
          </span>
        </li>`).join('') + '</ul>'
    : '';

  document.getElementById('departmentsManageList').innerHTML = departments.length
    ? '<ul class="manage-list-items">' + departments.map((d) => `
        <li>
          <span>${d}</span>
          <span class="manage-list-actions">
            <button class="rename-dept-btn" data-name="${d.replace(/"/g, '&quot;')}">Rename</button>
            <button class="delete-dept-btn danger" data-name="${d.replace(/"/g, '&quot;')}">Delete</button>
          </span>
        </li>`).join('') + '</ul>'
    : '';

  document.getElementById('schoolsList').innerHTML = schools.map((s) => `
    <div class="school-card">
      <div class="school-card-header">
        <h3>${s.code}${s.name && s.name !== s.code ? ' — ' + s.name : ''}</h3>
        <div class="school-card-actions">
          <button class="edit-school-btn" data-code="${s.code}" data-name="${(s.name || '').replace(/"/g, '&quot;')}">Edit</button>
          <button class="delete-school-btn danger" data-code="${s.code}">Delete</button>
        </div>
      </div>
      <table class="data-table school-recipients-table">
        <thead><tr><th>Department</th><th>To</th><th>CC</th><th></th></tr></thead>
        <tbody>
          ${departments.map((dept) => {
            const existing = (s.departments || []).find((d) => d.department === dept) || { to_emails: '', cc_emails: '' };
            return `
              <tr data-school="${s.code}" data-dept="${dept}">
                <td data-label="Department">${dept}</td>
                <td data-label="To"><input class="recipient-to" value="${existing.to_emails || ''}" placeholder="comma-separated emails" required /></td>
                <td data-label="CC"><input class="recipient-cc" value="${existing.cc_emails || ''}" placeholder="comma-separated emails" /></td>
                <td data-label=""><button class="save-recipients-btn">Save</button></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  document.querySelectorAll('.save-recipients-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const toInput = tr.querySelector('.recipient-to');
      const to = toInput.value.trim();
      const cc = tr.querySelector('.recipient-cc').value.trim();
      if (!toInput.reportValidity()) return;
      await api(`/schools/${encodeURIComponent(tr.dataset.school)}/departments/${encodeURIComponent(tr.dataset.dept)}`, {
        method: 'PUT', body: JSON.stringify({ to, cc })
      });
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    });
  });

  document.querySelectorAll('.edit-school-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newName = prompt('Full name / label for ' + btn.dataset.code, btn.dataset.name);
      if (newName === null) return;
      await api('/schools', { method: 'POST', body: JSON.stringify({ code: btn.dataset.code, name: newName }) });
      loadSchools();
    });
  });

  document.querySelectorAll('.delete-school-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteWithConfirm(
      `/schools/${encodeURIComponent(btn.dataset.code)}`,
      `school "${btn.dataset.code}" (and its recipient rows)`
    ));
  });

  document.querySelectorAll('.rename-dept-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newName = prompt('Rename department', btn.dataset.name);
      if (!newName || newName === btn.dataset.name) return;
      await api(`/schools/departments/${encodeURIComponent(btn.dataset.name)}`, {
        method: 'PUT', body: JSON.stringify({ name: newName })
      });
      loadSchools();
    });
  });

  document.querySelectorAll('.delete-dept-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteWithConfirm(
      `/schools/departments/${encodeURIComponent(btn.dataset.name)}`,
      `department "${btn.dataset.name}" (across all schools)`
    ));
  });
}

/**
 * Deletes a school or department. If exigencies still reference it, the
 * server responds 409 with a record count — re-confirm with that count
 * before retrying with ?force=true (deletes anyway, leaves historical
 * exigency records with a dangling label, doesn't touch them).
 */
async function deleteWithConfirm(path, label) {
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
  let res = await fetch('/api' + path, { method: 'DELETE' });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    const proceed = confirm(
      `${body.count} exigency record(s) still reference this ${label}. ` +
      `They will be kept as-is, but recipient routing for it will be removed. Continue?`
    );
    if (!proceed) return;
    res = await fetch('/api' + path + '?force=true', { method: 'DELETE' });
  }
  if (!res.ok) {
    alert('Delete failed: ' + res.statusText);
    return;
  }
  loadSchools();
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
  'SenderEmail', 'MailingEnabled', 'AlertEmail', 'DefaultCC', 'ForceRecipientEmail',
  'ReminderTriggerHour', 'ReminderDelayDays'
];

// Display-only label overrides — the underlying setting key (left side)
// stays what the backend reads/writes; only the on-screen text changes.
const SETTINGS_LABELS = {
  SenderEmail: 'Admin Email (Sender Email)',
  ForceRecipientEmail: 'Extra Recipient Email'
};

async function loadSettings() {
  const settings = await api('/settings');
  const form = document.getElementById('settingsForm');
  form.innerHTML = SETTINGS_FIELDS.map((key) => `
    <label for="setting-${key}">${SETTINGS_LABELS[key] || key}</label>
    <input id="setting-${key}" name="${key}" value="${settings[key] || ''}" />
  `).join('');
}

document.getElementById('adminLogoutBtn').addEventListener('click', () => {
  localStorage.removeItem('adminToken');
  showLoginOverlay();
});

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const payload = {};
  SETTINGS_FIELDS.forEach((key) => {
    const el = document.getElementById('setting-' + key);
    if (el) payload[key] = el.value;
  });
  try {
    await api('/settings', { method: 'PUT', body: JSON.stringify(payload) });
    document.getElementById('settingsSaved').textContent = 'Saved (restart server to apply new reminder hour).';
    setTimeout(() => { document.getElementById('settingsSaved').textContent = ''; }, 4000);
  } catch (err) {
    document.getElementById('settingsSaved').textContent = 'Save failed: ' + err.message;
  }
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

/**
 * Whole-dashboard login gate — this app shows PII (submitter emails,
 * incident details) and lets an admin trigger real emails/deletes, so
 * nothing renders until a valid admin token is confirmed. The token itself
 * is checked server-side (GET /api/admin/verify) rather than just trusting
 * that localStorage has *something* in it.
 */
let refreshTimer = null;

function showLoginOverlay(message) {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  document.getElementById('appShell').hidden = true;
  document.getElementById('appLoginOverlay').hidden = false;
  document.getElementById('appLoginError').textContent = message || '';
}

function showApp() {
  document.getElementById('appLoginOverlay').hidden = true;
  document.getElementById('appShell').hidden = false;
  initApp();
}

function initApp() {
  loadSchools().then(loadDashboard);

  /**
   * Auto-refresh the active tab every 5s so new submissions/replies (the
   * IMAP watcher can land a reply within seconds) show up without a manual
   * refresh. Skipped while the user is actively editing a field in the
   * exigencies table, so a background refresh never wipes out an
   * in-progress edit.
   */
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    const activeTab = document.querySelector('.tab-panel.active')?.id;
    if (activeTab === 'tab-exigencies') {
      const table = document.getElementById('exigenciesTable');
      if (document.activeElement && table.contains(document.activeElement)) return;
      loadExigencies();
    } else if (activeTab === 'tab-dashboard') {
      loadDashboard();
    } else if (activeTab === 'tab-logs') {
      loadLogs();
    }
  }, 5000);
}

document.getElementById('appLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('appLoginUsername').value;
  const password = document.getElementById('appLoginPassword').value;
  const errorEl = document.getElementById('appLoginError');
  errorEl.textContent = '';
  try {
    const { token } = await api('/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    localStorage.setItem('adminToken', token);
    document.getElementById('appLoginForm').reset();
    showApp();
  } catch (err) {
    errorEl.textContent = 'Login failed: ' + err.message;
  }
});

// Boot: verify any stored token with the server before showing the app —
// an expired/tampered token in localStorage must not grant a false sense
// of being logged in.
(async () => {
  const token = getAdminToken();
  if (!token) { showLoginOverlay(); return; }
  try {
    await api('/admin/verify');
    showApp();
  } catch {
    localStorage.removeItem('adminToken');
    showLoginOverlay('Session expired — please log in again.');
  }
})();
