ALTER TABLE giveaway_settings
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE discord_guild_settings
  ADD COLUMN IF NOT EXISTS giveaway_active BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS discord_coupon_accounts (
  guild_id TEXT NOT NULL REFERENCES discord_guild_settings(guild_id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  twitch_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS discord_coupon_accounts_twitch_idx
  ON discord_coupon_accounts (LOWER(twitch_username));
