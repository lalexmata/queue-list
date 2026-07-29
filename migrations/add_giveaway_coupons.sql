CREATE TABLE IF NOT EXISTS giveaway_participants (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'twitch',
  coupon_count INTEGER NOT NULL DEFAULT 1 CHECK (coupon_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE giveaway_participants
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'twitch';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'giveaway_participants' AND column_name = 'twitch_username'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'giveaway_participants' AND column_name = 'username'
  ) THEN
    ALTER TABLE giveaway_participants RENAME COLUMN twitch_username TO username;
  END IF;
END $$;

DROP INDEX IF EXISTS giveaway_participants_username_idx;

CREATE UNIQUE INDEX IF NOT EXISTS giveaway_participants_platform_username_idx
  ON giveaway_participants (LOWER(platform), LOWER(username));
