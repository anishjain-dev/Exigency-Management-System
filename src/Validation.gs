/**
 * Validation.gs
 *
 * Row-level and submitter-level validation rules. Nothing here mutates
 * sheets except to flag invalid rows in the Logs sheet — validation is a
 * detective, non-destructive control (see ARCHITECTURE.md #9).
 */

/**
 * Validates that a freshly submitted row has the minimum required fields.
 * @param {Object} rowData Header-keyed row data (see Utilities.readRowsAsObjects_).
 * @return {{valid: boolean, errors: Array<string>}}
 */
function validateRow(rowData) {
  const errors = [];

  if (!rowData[DATA_COLUMNS.SCHOOL]) {
    errors.push('Missing School');
  }
  if (!rowData[DATA_COLUMNS.ISSUE]) {
    errors.push('Missing Issue description');
  }
  if (!rowData[DATA_COLUMNS.OWNER]) {
    errors.push('Missing Owner');
  }
  if (!toDateOrNull_(rowData[DATA_COLUMNS.FOLLOWUP_DATE])) {
    errors.push('Missing or invalid Follow-up Date');
  }

  return { valid: errors.length === 0, errors: errors };
}

/**
 * Checks whether the submitter's email belongs to the authorized FS Group.
 *
 * The Google Form itself should be configured with "Restrict to users in
 * [organization]" and "Collect email addresses" turned on — this is the
 * preventive control. This function is the detective/defense-in-depth check
 * run once the row lands in the sheet, so unauthorized rows are flagged in
 * Logs for admin follow-up rather than silently trusted.
 *
 * @param {string} submitterEmail
 * @param {Object} config Result of loadConfiguration().
 * @return {boolean}
 */
function isAuthorizedSubmitter_(submitterEmail, config) {
  if (!submitterEmail) return false;
  const email = String(submitterEmail).trim().toLowerCase();

  // Exact match against the configured FS group alias, if the group itself
  // was used as the submitter identity (e.g. shared submission account).
  if (config.fsGroupEmail && email === config.fsGroupEmail.toLowerCase()) {
    return true;
  }

  // Domain-based check: submitter must belong to the configured org domain.
  if (config.orgDomain) {
    const domain = config.orgDomain.toLowerCase().replace(/^@/, '');
    return email.indexOf('@' + domain) !== -1 && email.endsWith('@' + domain);
  }

  // If no domain/group configured, fail open is NOT acceptable — default deny
  // and let the admin see it flagged in Logs rather than assume it's fine.
  return false;
}

/**
 * Validates that a school code referenced by a row actually maps to a
 * configured school sheet.
 * @param {string} schoolCode
 * @param {Object} config
 * @return {boolean}
 */
function isKnownSchool_(schoolCode, config) {
  if (!schoolCode) return false;
  const normalized = String(schoolCode).trim().toUpperCase();
  return config.schoolCodes.some(function (code) {
    return code.toUpperCase() === normalized;
  });
}
