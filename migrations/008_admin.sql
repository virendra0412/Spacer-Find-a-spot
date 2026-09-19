-- No separate admin table/role system for v1 — a boolean flag on users,
-- granted by hand via SQL for now (see README). This is deliberately
-- minimal: the goal right now is basic visibility and moderation power,
-- not a full permissions system.
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
