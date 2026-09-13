// ============================================================
// Turso Client — حفظ علامات الأسئلة ونتائج الاختبارات
// ============================================================

const TURSO_USER_KEY = 'auc_mcq_student_code';
const TURSO_NAME_KEY = 'auc_mcq_student_name';
const TURSO_SUBJECT = 'medicine';
const FLAGS_API = '/api/flags';

function getTursoUserId() {
  return localStorage.getItem(TURSO_USER_KEY) || 'guest';
}

function getTursoStudentName() {
  return localStorage.getItem(TURSO_NAME_KEY) || '';
}

function setTursoStudent(student) {
  localStorage.setItem(TURSO_USER_KEY, student.code);
  localStorage.setItem(TURSO_NAME_KEY, student.name);
}

async function registerTursoStudent(name) {
  const response = await fetch(FLAGS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'registerStudent', name, subject: TURSO_SUBJECT })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const data = await response.json();
  setTursoStudent(data.student);
  return data.student;
}

async function getTursoStudent(code) {
  const response = await fetch(`${FLAGS_API}?type=student&userId=${encodeURIComponent(code)}&subject=${encodeURIComponent(TURSO_SUBJECT)}`);
  if (!response.ok) throw new Error('الكود غير صحيح أو غير موجود');
  const data = await response.json();
  return data.student;
}

async function tursoGetFlags() {
  const userId = getTursoUserId();
  const response = await fetch(`${FLAGS_API}?userId=${encodeURIComponent(userId)}&subject=${encodeURIComponent(TURSO_SUBJECT)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const data = await response.json();
  const flags = {};
  (data.flags || []).forEach(row => {
    flags[row.q_key] = {
      key: row.q_key, qText: row.q_text, num: row.num, section: row.section,
      secName: row.sec_name, examName: row.exam_name, flagType: row.flag_type, flaggedAt: row.flagged_at
    };
  });
  return flags;
}

async function tursoSaveFlag(qKey, flagData) {
  const response = await fetch(FLAGS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: getTursoUserId(), qKey, qText: flagData.qText || '', num: flagData.num || 0,
      section: flagData.section || '', secName: flagData.secName || '', examName: flagData.examName || '',
      flagType: flagData.flagType, flaggedAt: flagData.flaggedAt || Date.now(), subject: TURSO_SUBJECT
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

async function tursoDeleteFlag(qKey) {
  const response = await fetch(`${FLAGS_API}?userId=${encodeURIComponent(getTursoUserId())}&qKey=${encodeURIComponent(qKey)}&subject=${encodeURIComponent(TURSO_SUBJECT)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

async function tursoClearAllFlags() {
  const response = await fetch(`${FLAGS_API}?userId=${encodeURIComponent(getTursoUserId())}&subject=${encodeURIComponent(TURSO_SUBJECT)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

async function tursoSaveQuizResult(result) {
  const response = await fetch(FLAGS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'saveResult', studentCode: getTursoUserId(), subject: TURSO_SUBJECT, ...result })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

async function tursoGetStats() {
  const response = await fetch(`${FLAGS_API}?type=stats&userId=${encodeURIComponent(getTursoUserId())}&subject=${encodeURIComponent(TURSO_SUBJECT)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const data = await response.json();
  return data.stats || {};
}
