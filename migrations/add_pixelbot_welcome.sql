ALTER TABLE discord_guild_settings
  ADD COLUMN IF NOT EXISTS welcome_channel_id TEXT;
