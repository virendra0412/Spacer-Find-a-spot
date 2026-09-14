const { pool } = require('../config/db');

// Fire-and-forget push via Expo's push service. Callers should .catch()
// this so a notification failure never breaks the actual booking flow.
async function notifyUser(userId, title, body) {
  const { rows } = await pool.query(
    'SELECT expo_push_token FROM devices WHERE user_id = $1',
    [userId]
  );
  if (rows.length === 0) return;

  const messages = rows.map((r) => ({
    to: r.expo_push_token,
    sound: 'default',
    title,
    body,
  }));

  await fetch(process.env.EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
}

module.exports = { notifyUser };
