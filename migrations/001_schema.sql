CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$;

DROP TABLE IF EXISTS fees CASCADE;
DROP TABLE IF EXISTS reimbursements CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS project_items CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS member_accounts CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS movement_types CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'tesoureiro')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'integration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE movement_types (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  name TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense', 'both')),
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'integration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  branch TEXT NOT NULL CHECK (
    branch IN ('filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis')
  ),
  role TEXT NOT NULL CHECK (role IN ('jovem', 'escotista', 'dirigente', 'clube')),
  monthly_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  joined_at DATE NOT NULL,
  clube_ltc BOOLEAN NOT NULL DEFAULT FALSE,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'integration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE member_accounts (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  member_id UUID NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  holder_name TEXT NOT NULL,
  holder_kind TEXT NOT NULL CHECK (holder_kind IN ('parent', 'youth', 'other')),
  relationship TEXT NOT NULL DEFAULT '',
  pix_key TEXT NOT NULL DEFAULT '',
  bank TEXT NOT NULL DEFAULT '',
  agency TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  document TEXT NOT NULL DEFAULT '',
  notes TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'integration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  branch TEXT NOT NULL CHECK (
    branch IN ('filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis', 'grupo')
  ),
  year INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'integration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE project_items (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  planned NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE fees (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  name TEXT NOT NULL UNIQUE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'integration')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  nature TEXT NOT NULL CHECK (nature IN ('fixed', 'variable')),
  movement_type_id UUID NOT NULL REFERENCES movement_types (id),
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  branch TEXT NOT NULL CHECK (
    branch IN ('filhote', 'lobinho', 'escoteiro', 'senior', 'pioneiro', 'flor-de-lis', 'grupo')
  ),
  method TEXT NOT NULL CHECK (method IN ('pix', 'cash', 'transfer', 'card', 'other')),
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'pending')),
  member_id UUID REFERENCES members (id) ON DELETE SET NULL,
  member_account_id UUID REFERENCES member_accounts (id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects (id) ON DELETE SET NULL,
  notes TEXT,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'integration')),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  group_name TEXT NOT NULL
);

CREATE INDEX idx_transactions_date ON transactions (date);
CREATE INDEX idx_transactions_branch ON transactions (branch);
CREATE INDEX idx_transactions_movement_type ON transactions (movement_type_id);
CREATE INDEX idx_transactions_payment_status ON transactions (payment_status);
CREATE INDEX idx_members_joined_at ON members (joined_at);
CREATE INDEX idx_member_accounts_member_id ON member_accounts (member_id);
