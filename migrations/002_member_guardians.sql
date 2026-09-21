CREATE TABLE IF NOT EXISTS member_guardians (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  member_id UUID NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'integration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_member_guardians_member ON member_guardians (member_id);
