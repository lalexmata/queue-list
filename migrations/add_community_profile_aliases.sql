CREATE TABLE IF NOT EXISTS community_profile_aliases (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES community_profiles(id) ON DELETE CASCADE,
  alias TEXT NOT NULL CHECK (char_length(alias) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS community_profile_aliases_unique_idx
  ON community_profile_aliases (profile_id, LOWER(alias));

CREATE INDEX IF NOT EXISTS community_profile_aliases_search_idx
  ON community_profile_aliases (LOWER(alias));
