ALTER TABLE listing_photos
  ADD COLUMN public_id TEXT;

CREATE TYPE identity_verification_status AS ENUM ('unsubmitted', 'pending', 'approved', 'rejected');

CREATE TABLE identity_verifications (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  document_url          TEXT NOT NULL,
  document_public_id    TEXT NOT NULL,
  selfie_url            TEXT NOT NULL,
  selfie_public_id      TEXT NOT NULL,
  status                identity_verification_status NOT NULL DEFAULT 'pending',
  review_note           TEXT,
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at           TIMESTAMPTZ,
  reviewed_by           UUID REFERENCES users(id)
);

CREATE INDEX idx_identity_verifications_status
  ON identity_verifications (status, submitted_at DESC);
