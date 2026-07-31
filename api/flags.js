const { createClient } = require('@libsql/client');

let client = null;
let tableCreated = false;

function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

async function ensureTable() {
  if (tableCreated) return;
  const db = getClient();
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
  // Try adding column subject if table already existed without it
  try {
    await db.execute(`ALTER TABLE flagged_questions ADD COLUMN subject TEXT DEFAULT 'medicine'`);
  } catch (e) {
    // Column already exists, ignore
  }
  tableCreated = true;
}

module.exports = async function handler(req, res) {
  // CORS headers (needed for local development)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await ensureTable();
    const db = getClient();

    // GET — Fetch all flagged questions for a user (optionally filtered by subject)
    if (req.method === 'GET') {
      const userId = req.query.userId || 'default';
      const subject = req.query.subject || '';

      let sql = 'SELECT q_key, q_text, num, section, sec_name, exam_name, flag_type, flagged_at, subject FROM flagged_questions WHERE user_id = ?';
      let args = [userId];

      if (subject) {
        sql += ' AND subject = ?';
        args.push(subject);
      }

      const result = await db.execute({ sql, args });
      return res.status(200).json({ flags: result.rows });
    }

    // POST — Save/update a flagged question (upsert)
    if (req.method === 'POST') {
      const { userId, qKey, qText, num, section, secName, examName, flagType, flaggedAt, subject } = req.body;
      if (!qKey || !flagType) {
        return res.status(400).json({ error: 'qKey and flagType are required' });
      }
      const subj = subject || 'medicine';
      await db.execute({
        sql: `INSERT INTO flagged_questions (user_id, q_key, q_text, num, section, sec_name, exam_name, flag_type, flagged_at, subject)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, q_key) DO UPDATE SET
                q_text = excluded.q_text,
                num = excluded.num,
                section = excluded.section,
                sec_name = excluded.sec_name,
                exam_name = excluded.exam_name,
                flag_type = excluded.flag_type,
                flagged_at = excluded.flagged_at,
                subject = excluded.subject`,
        args: [
          userId || 'default',
          qKey,
          qText || '',
          num || 0,
          section || '',
          secName || '',
          examName || '',
          flagType,
          flaggedAt || 0,
          subj
        ],
      });
      return res.status(200).json({ success: true });
    }

    // DELETE — Remove a specific flag or all flags for a user (optionally filtered by subject)
    if (req.method === 'DELETE') {
      const userId = req.query.userId || 'default';
      const qKey = req.query.qKey;
      const subject = req.query.subject || '';

      if (qKey) {
        // Delete single flag
        await db.execute({
          sql: 'DELETE FROM flagged_questions WHERE user_id = ? AND q_key = ?',
          args: [userId, qKey],
        });
      } else if (subject) {
        // Delete all flags for user in this subject
        await db.execute({
          sql: 'DELETE FROM flagged_questions WHERE user_id = ? AND subject = ?',
          args: [userId, subject],
        });
      } else {
        // Delete all flags for user
        await db.execute({
          sql: 'DELETE FROM flagged_questions WHERE user_id = ?',
          args: [userId],
        });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Turso API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
