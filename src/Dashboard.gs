/**
 * Dashboard.gs
 *
 * Recomputes KPIs and school-wise counts into the Dashboard sheet and keeps
 * a chart in sync. Computation (computeKpis_) is kept separate from
 * rendering (renderDashboard_) so Stage 2 (monthly reports, school
 * performance, response/resolution time) can add new compute functions
 * without touching the render layer — see ARCHITECTURE.md #13.
 */

const DASHBOARD_LAYOUT_ = Object.freeze({
  TITLE_ROW: 1,
  KPI_HEADER_ROW: 3,
  KPI_VALUE_ROW: 4,
  SCHOOL_TABLE_HEADER_ROW: 7
});

/**
 * Public entry point: recomputes and re-renders the Dashboard sheet.
 */
function updateDashboard() {
  try {
    const master = getEmsSpreadsheet_().getSheetByName(SYSTEM_SHEETS.MASTER);
    if (!master) return;

    const config = loadConfiguration();
    const rows = readRowsAsObjects_(master).map(function (r) { return r.data; });
    const kpis = computeKpis_(rows, config);
    const schoolCounts = computeSchoolCounts_(rows, config);

    renderDashboard_(kpis, schoolCounts, config);
  } catch (error) {
    logError_('updateDashboard', error, false);
  }
}

/**
 * @param {Array<Object>} rows Header-keyed master rows.
 * @param {Object} config
 * @return {Object} KPI totals.
 * @private
 */
function computeKpis_(rows, config) {
  let total = 0, open = 0, closed = 0, pending = 0, todayFollowups = 0, overdue = 0;

  rows.forEach(function (row) {
    const exigencyId = row[SYSTEM_COLUMNS.EXIGENCY_ID];
    if (!exigencyId) return; // skip invalid/unassigned rows
    total++;

    const status = row[DATA_COLUMNS.STATUS];
    const followUpDate = toDateOrNull_(row[DATA_COLUMNS.FOLLOWUP_DATE]);
    const nextDueDate = toDateOrNull_(row[DATA_COLUMNS.NEXT_DUE_DATE]);

    if (status === config.closedStatus) {
      closed++;
      return;
    }
    open++;

    if (!nextDueDate) pending++;
    if (followUpDate && isSameDay_(followUpDate, new Date())) todayFollowups++;
    if (followUpDate && isTodayOrPast_(followUpDate) && !nextDueDate) overdue++;
  });

  return {
    total: total,
    open: open,
    closed: closed,
    pending: pending,
    todayFollowups: todayFollowups,
    overdue: overdue
  };
}

/**
 * @param {Array<Object>} rows
 * @param {Object} config
 * @return {Array<{school:string, total:number, open:number, closed:number}>}
 * @private
 */
function computeSchoolCounts_(rows, config) {
  const bySchool = {};
  config.schoolCodes.forEach(function (code) {
    bySchool[code] = { school: code, total: 0, open: 0, closed: 0 };
  });

  rows.forEach(function (row) {
    if (!row[SYSTEM_COLUMNS.EXIGENCY_ID]) return;
    const code = extractSchoolCode_(row[DATA_COLUMNS.SCHOOL], config);
    if (!bySchool[code]) bySchool[code] = { school: code, total: 0, open: 0, closed: 0 };
    bySchool[code].total++;
    if (row[DATA_COLUMNS.STATUS] === config.closedStatus) {
      bySchool[code].closed++;
    } else {
      bySchool[code].open++;
    }
  });

  return Object.keys(bySchool).map(function (k) { return bySchool[k]; });
}

/**
 * Renders KPI values and the school-wise table into the Dashboard sheet,
 * creating the sheet and a bar chart on first run.
 * @param {Object} kpis
 * @param {Array<Object>} schoolCounts
 * @param {Object} config
 * @private
 */
function renderDashboard_(kpis, schoolCounts, config) {
  const ss = getEmsSpreadsheet_();
  let sheet = ss.getSheetByName(SYSTEM_SHEETS.DASHBOARD);
  if (!sheet) sheet = ss.insertSheet(SYSTEM_SHEETS.DASHBOARD);

  sheet.getRange(DASHBOARD_LAYOUT_.TITLE_ROW, 1)
    .setValue('Exigency Management Dashboard — Updated ' + new Date().toLocaleString())
    .setFontWeight('bold').setFontSize(14);

  const kpiHeaders = ['Total', 'Open', 'Closed', 'Pending', "Today's Follow-ups", 'Overdue'];
  const kpiValues = [kpis.total, kpis.open, kpis.closed, kpis.pending, kpis.todayFollowups, kpis.overdue];

  sheet.getRange(DASHBOARD_LAYOUT_.KPI_HEADER_ROW, 1, 1, kpiHeaders.length)
    .setValues([kpiHeaders]).setFontWeight('bold').setBackground('#f1f3f4');
  sheet.getRange(DASHBOARD_LAYOUT_.KPI_VALUE_ROW, 1, 1, kpiValues.length)
    .setValues([kpiValues]).setFontSize(18).setHorizontalAlignment('center');

  const tableHeaderRow = DASHBOARD_LAYOUT_.SCHOOL_TABLE_HEADER_ROW;
  const tableHeaders = ['School', 'Total', 'Open', 'Closed'];
  sheet.getRange(tableHeaderRow, 1, 1, tableHeaders.length)
    .setValues([tableHeaders]).setFontWeight('bold').setBackground('#f1f3f4');

  if (schoolCounts.length) {
    const tableValues = schoolCounts.map(function (r) { return [r.school, r.total, r.open, r.closed]; });
    sheet.getRange(tableHeaderRow + 1, 1, tableValues.length, tableHeaders.length).setValues(tableValues);

    insertOrUpdateSchoolChart_(sheet, tableHeaderRow, tableValues.length, tableHeaders.length);
  }

  sheet.autoResizeColumns(1, Math.max(kpiHeaders.length, tableHeaders.length));
}

/**
 * Creates the school-wise bar chart on first run, or updates its range on
 * subsequent runs so it always reflects the current row count.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} tableHeaderRow
 * @param {number} numDataRows
 * @param {number} numCols
 * @private
 */
function insertOrUpdateSchoolChart_(sheet, tableHeaderRow, numDataRows, numCols) {
  const range = sheet.getRange(tableHeaderRow, 1, numDataRows + 1, numCols);
  const charts = sheet.getCharts();
  const existing = charts.find(function (c) { return c.getOptions().get('title') === 'Exigencies by School'; });

  if (existing) {
    const updated = existing.modify().clearRanges().addRange(range).build();
    sheet.updateChart(updated);
    return;
  }

  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(range)
    .setPosition(tableHeaderRow, numCols + 2, 0, 0)
    .setOption('title', 'Exigencies by School')
    .setOption('legend', { position: 'top' })
    .build();
  sheet.insertChart(chart);
}
