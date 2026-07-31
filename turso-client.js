// ============================================================
// Turso Client — Browser-side API wrapper for flagged questions
// Communicates with /api/flags Vercel serverless function
// ============================================================

const TURSO_USER_KEY = 'auc_mcq_username';
const TURSO_SUBJECT = 'medicine';

function getTursoUserId() {
  return localStorage.getItem(TURSO_USER_KEY) || 'guest';
}

function setTursoUsername(username) {
  localStorage.setItem(TURSO_USER_KEY, username.trim());
}

// API endpoint (same origin — works on Vercel)
const FLAGS_API = '/api/flags';

/**
 * Fetch all flagged questions from Turso for the current user and current subject.
 * Returns an object keyed by q_key: { key, qText, num, section, secName, examName, flagType, flaggedAt }
 */
async function tursoGetFlags() {
  const userId = getTursoUserId();
  const response = await fetch(`${FLAGS_API}?userId=${encodeURIComponent(userId)}&subject=${encodeURIComponent(TURSO_SUBJECT)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const data = await response.json();

  const flags = {};
  (data.flags || []).forEach(row => {
    flags[row.q_key] = {
      key: row.q_key,
      qText: row.q_text,
      num: row.num,
      section: row.section,
      secName: row.sec_name,
      examName: row.exam_name,
      flagType: row.flag_type,
      flaggedAt: row.flagged_at
    };
  });
  return flags;
}

/**
 * Save or update a flagged question in Turso with subject scope.
 */
async function tursoSaveFlag(qKey, flagData) {
  const userId = getTursoUserId();
  const response = await fetch(FLAGS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      qKey,
      qText: flagData.qText || '',
      num: flagData.num || 0,
      section: flagData.section || '',
      secName: flagData.secName || '',
      examName: flagData.examName || '',
      flagType: flagData.flagType,
      flaggedAt: flagData.flaggedAt || Date.now(),
      subject: TURSO_SUBJECT
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

/**
 * Delete a specific flagged question from Turso.
 */
async function tursoDeleteFlag(qKey) {
  const userId = getTursoUserId();
  const response = await fetch(
    `${FLAGS_API}?userId=${encodeURIComponent(userId)}&qKey=${encodeURIComponent(qKey)}&subject=${encodeURIComponent(TURSO_SUBJECT)}`,
    { method: 'DELETE' }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

/**
 * Delete ALL flagged questions for the current user in this subject.
 */
async function tursoClearAllFlags() {
  const userId = getTursoUserId();
  const response = await fetch(
    `${FLAGS_API}?userId=${encodeURIComponent(userId)}&subject=${encodeURIComponent(TURSO_SUBJECT)}`,
    { method: 'DELETE' }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}
