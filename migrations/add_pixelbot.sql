CREATE TABLE IF NOT EXISTS discord_guild_settings (
  guild_id TEXT PRIMARY KEY,
  guild_name TEXT,
  allowed_channel_id TEXT,
  birthday_channel_id TEXT,
  welcome_channel_id TEXT,
  admin_role_id TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  fortnite_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  birthdays_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default_birthday_guild BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fortnite_accounts (
  guild_id TEXT NOT NULL REFERENCES discord_guild_settings(guild_id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  epic_name TEXT NOT NULL,
  epic_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS community_profiles (
  id BIGSERIAL PRIMARY KEY,
  display_name TEXT,
  notes TEXT,
  birth_month SMALLINT CHECK (birth_month BETWEEN 1 AND 12),
  birth_day SMALLINT CHECK (birth_day BETWEEN 1 AND 31),
  birth_year SMALLINT CHECK (birth_year BETWEEN 1900 AND 2100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_identities (
  profile_id BIGINT NOT NULL REFERENCES community_profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'twitch', 'youtube', 'kick', 'epic', 'tiktok', 'facebook', 'instagram', 'other')),
  community_id TEXT NOT NULL DEFAULT '',
  platform_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform, community_id, platform_user_id)
);

CREATE TABLE IF NOT EXISTS birthday_announcements (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  announcement_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, discord_user_id, announcement_date)
);

CREATE INDEX IF NOT EXISTS community_profiles_date_idx
  ON community_profiles (birth_month, birth_day);

CREATE INDEX IF NOT EXISTS community_identities_profile_idx
  ON community_identities (profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS discord_guild_settings_one_default_birthday_idx
  ON discord_guild_settings (is_default_birthday_guild)
  WHERE is_default_birthday_guild = TRUE;
