-- ONEHUB core schema. Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  accent        text NOT NULL DEFAULT '#C9A961',
  bio           text NOT NULL DEFAULT '',
  status_text   text NOT NULL DEFAULT '',
  is_admin      boolean NOT NULL DEFAULT false,
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  accent      text NOT NULL DEFAULT '#C9A961',
  owner_id    uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname     text,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE IF NOT EXISTS roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#9CA3AF',
  permissions  bigint NOT NULL DEFAULT 0,
  position     int NOT NULL DEFAULT 0,
  is_default   boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS roles_community ON roles(community_id);

CREATE TABLE IF NOT EXISTS member_roles (
  community_id uuid NOT NULL,
  user_id      uuid NOT NULL,
  role_id      uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (community_id, user_id, role_id),
  FOREIGN KEY (community_id, user_id) REFERENCES members(community_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('text', 'voice', 'announcement')),
  category     text NOT NULL DEFAULT 'General',
  topic        text NOT NULL DEFAULT '',
  position     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channels_community ON channels(community_id);

CREATE TABLE IF NOT EXISTS dm_threads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_key   text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dm_participants (
  dm_id   uuid NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (dm_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  dm_id      uuid REFERENCES dm_threads(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz,
  CHECK ((channel_id IS NULL) <> (dm_id IS NULL))
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_dm ON messages(dm_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invites (
  code         text PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  creator_id   uuid NOT NULL REFERENCES users(id),
  uses         int NOT NULL DEFAULT 0,
  max_uses     int,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bans (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by    uuid NOT NULL REFERENCES users(id),
  reason       text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id    uuid NOT NULL REFERENCES users(id),
  target_user_id uuid REFERENCES users(id),
  message_id     uuid REFERENCES messages(id) ON DELETE SET NULL,
  community_id   uuid REFERENCES communities(id) ON DELETE CASCADE,
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           bigserial PRIMARY KEY,
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  actor_id     uuid NOT NULL REFERENCES users(id),
  action       text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
