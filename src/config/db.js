const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // A background/idle client threw an error — log and let the process
  // crash rather than silently keep serving on a broken pool.
  console.error('Unexpected Postgres pool error', err);
  process.exit(1);
});

module.exports = { pool };
