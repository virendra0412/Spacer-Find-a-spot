-- Records admin actions that change platform state in a way that isn't
-- already self-evident from the affected row (a listing's status column
-- already shows it was moderated, but nothing on the users table shows
-- *who* granted someone admin access or *when* — this table is that
-- record). Deliberately generic (action + detail) rather than a rigid
-- per-action-type schema, so future admin actions can log here too
-- without another migration.
CREATE TABLE admin_audit_log (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id         UUID NOT NULL REFERENCES users(id),
  action           TEXT NOT NULL,
  target_user_id   UUID REFERENCES users(id),
  detail           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_created ON admin_audit_log (created_at DESC);
