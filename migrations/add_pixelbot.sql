CREATE TABLE IF NOT EXISTS discord_guild_settings (
  guild_id TEXT PRIMARY KEY,
  guild_name TEXT,
  allowed_channel_id TEXT,
  birthday_channel_id TEXT,
  admin_role_id TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  fortnite_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  birthdays_enabled BOOLEAN NOT NULL DEFAULT TRUE,
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

CREATE TABLE IF NOT EXISTS discord_birthdays (
  guild_id TEXT NOT NULL REFERENCES discord_guild_settings(guild_id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  birth_month SMALLINT NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  birth_day SMALLINT NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
  birth_year SMALLINT CHECK (birth_year BETWEEN 1900 AND 2100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS birthday_announcements (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  announcement_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, discord_user_id, announcement_date)
);

CREATE INDEX IF NOT EXISTS discord_birthdays_date_idx
  ON discord_birthdays (birth_month, birth_day);
