ALTER TABLE giveaway_coupon_sources
  DROP CONSTRAINT IF EXISTS giveaway_coupon_sources_source_check;

ALTER TABLE giveaway_coupon_sources
  ADD CONSTRAINT giveaway_coupon_sources_source_check
  CHECK (source IN ('channel_points', 'subscriber', 'gifted_subs', 'bits', 'purchase'));

CREATE TABLE IF NOT EXISTS giveaway_stream_events (
  id BIGSERIAL PRIMARY KEY,
  giveaway_id BIGINT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  participant_id BIGINT REFERENCES giveaway_participants(id) ON DELETE SET NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('subscription', 'gifted_subs', 'bits')),
  username TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_type, event_id)
);

CREATE TABLE IF NOT EXISTS giveaway_stream_bit_balances (
  giveaway_id BIGINT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'twitch',
  username TEXT NOT NULL,
  total_bits INTEGER NOT NULL DEFAULT 0 CHECK (total_bits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (giveaway_id, platform, username)
);
