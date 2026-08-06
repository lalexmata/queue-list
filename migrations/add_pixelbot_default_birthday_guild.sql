ALTER TABLE discord_guild_settings
  ADD COLUMN IF NOT EXISTS is_default_birthday_guild BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS discord_guild_settings_one_default_birthday_idx
  ON discord_guild_settings (is_default_birthday_guild)
  WHERE is_default_birthday_guild = TRUE;
