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

CREATE TABLE IF NOT EXISTS giveaway_coupon_sources (
  participant_id BIGINT NOT NULL REFERENCES giveaway_participants(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('channel_points', 'subscriber', 'gifted_subs', 'bits', 'purchase')),
  coupon_count INTEGER NOT NULL DEFAULT 0 CHECK (coupon_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (participant_id, source)
);

CREATE TABLE IF NOT EXISTS giveaway_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  channel_points_limit INTEGER CHECK (channel_points_limit IS NULL OR channel_points_limit >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO giveaway_settings (id, channel_points_limit)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- Los registros anteriores no tenían origen. Se conservan como canjes de puntos.
INSERT INTO giveaway_coupon_sources (participant_id, source, coupon_count)
SELECT id, 'channel_points', coupon_count
FROM giveaway_participants
WHERE coupon_count > 0
ON CONFLICT (participant_id, source) DO NOTHING;
