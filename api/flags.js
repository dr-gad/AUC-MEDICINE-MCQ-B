const { createClient } = require('@libsql/client');

let client = null;
let tablesReady = false;

function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

function makeStudentCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'MED-';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

async function ensureTables() {
  if (tablesReady) return;
  const db = getClient();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS students (
      student_code TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT 'medicine',
      created_at INTEGER NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS flagged_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      q_key TEXT NOT NULL,
      q_text TEXT NOT NULL DEFAULT '',
      num INTEGER DEFAULT 0,
      section TEXT DEFAULT '',
      sec_name TEXT DEFAULT '',
      exam_name TEXT DEFAULT '',
      flag_type TEXT NOT NULL,
      flagged_at INTEGER DEFAULT 0,
      subject TEXT DEFAULT 'medicine',
      UNIQUE(user_id, q_key)
    )
  `);
  try {
    await db.execute(`ALTER TABLE flagged_questions ADD COLUMN subject TEXT DEFAULT 'medicine'`);
  } catch (e) {
    // Column already exists.
  }
  await db.execute(`
    CREATE TABLE IF NOT EXISTS quiz_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_code TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT 'medicine',
      total INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      wrong INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      elapsed_seconds INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER NOT NULL
    )
  `);
  tablesReady = true;
}

async function registerStudent(db, name, subject) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 3) throw new Error('الاسم قصير جداً');

  let code;
  for (let attempt = 0; attempt < 10; attempt++) {
    code = makeStudentCode();
    const exists = await db.execute({ sql: 'SELECT student_code FROM students WHERE student_code = ?', args: [code] });
    if (!exists.rows.length) break;
  }

  await db.execute({
    sql: 'INSERT INTO students (student_code, student_name, subject, created_at) VALUES (?, ?, ?, ?)',
    args: [code, cleanName, subject, Date.now()]
  });

  // Move any old name-based flags to the new student code when possible.
  await db.execute({
    sql: 'UPDATE flagged_questions SET user_id = ? WHERE user_id = ? AND subject = ?',
    args: [code, cleanName, subject]
  });

  return { code, name: cleanName, subject };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();
    const db = getClient();
    const subject = (req.query && req.query.subject) || (req.body && req.body.subject) || 'medicine';

    if (req.method === 'POST') {
      const body = req.body || {};

      if (body.action === 'registerStudent') {
        const student = await registerStudent(db, body.name, subject);
        return res.status(200).json({ success: true, student });
      }

      if (body.action === 'saveResult') {
        if (!body.studentCode) return res.status(400).json({ error: 'studentCode is required' });
        await db.execute({
          sql: `INSERT INTO quiz_results
            (student_code, subject, total, correct, wrong, skipped, elapsed_seconds, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            body.studentCode, subject, Number(body.total) || 0, Number(body.correct) || 0,
            Number(body.wrong) || 0, Number(body.skipped) || 0, Number(body.elapsedSeconds) || 0, Date.now()
          ]
        });
        return res.status(200).json({ success: true });
      }

      const { userId, qKey, qText, num, section, secName, examName, flagType, flaggedAt } = body;
      if (!qKey || !flagType) return res.status(400).json({ error: 'qKey and flagType are required' });
      await db.execute({
        sql: `INSERT INTO flagged_questions (user_id, q_key, q_text, num, section, sec_name, exam_name, flag_type, flagged_at, subject)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, q_key) DO UPDATE SET
                q_text = excluded.q_text, num = excluded.num, section = excluded.section,
                sec_name = excluded.sec_name, exam_name = excluded.exam_name,
                flag_type = excluded.flag_type, flagged_at = excluded.flagged_at, subject = excluded.subject`,
        args: [userId || 'default', qKey, qText || '', num || 0, section || '', secName || '', examName || '', flagType, flaggedAt || Date.now(), subject]
      });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      const userId = req.query.userId || 'default';
      if (req.query.type === 'student') {
        const result = await db.execute({
          sql: 'SELECT student_code, student_name, subject FROM students WHERE student_code = ? AND subject = ?',
          args: [userId, subject]
        });
        if (!result.rows.length) return res.status(404).json({ error: 'Student code not found' });
        return res.status(200).json({ student: result.rows[0] });
      }
      if (req.query.type === 'stats') {
        const result = await db.execute({
          sql: `SELECT COUNT(*) AS tests, COALESCE(SUM(total), 0) AS questions,
                COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(wrong), 0) AS wrong,
                COALESCE(SUM(skipped), 0) AS skipped
                FROM quiz_results WHERE student_code = ? AND subject = ?`,
          args: [userId, subject]
        });
        return res.status(200).json({ stats: result.rows[0] || {} });
      }

      let sql = 'SELECT q_key, q_text, num, section, sec_name, exam_name, flag_type, flagged_at, subject FROM flagged_questions WHERE user_id = ? AND subject = ?';
      const result = await db.execute({ sql, args: [userId, subject] });
      return res.status(200).json({ flags: result.rows });
    }

    if (req.method === 'DELETE') {
      const userId = req.query.userId || 'default';
      const qKey = req.query.qKey;
      if (qKey) {
        await db.execute({ sql: 'DELETE FROM flagged_questions WHERE user_id = ? AND q_key = ? AND subject = ?', args: [userId, qKey, subject] });
      } else {
        await db.execute({ sql: 'DELETE FROM flagged_questions WHERE user_id = ? AND subject = ?', args: [userId, subject] });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Turso API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
