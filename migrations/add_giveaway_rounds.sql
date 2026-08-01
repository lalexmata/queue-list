CREATE TABLE IF NOT EXISTS giveaways (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  draw_at TIMESTAMPTZ,
  winner_count INTEGER NOT NULL DEFAULT 1 CHECK (winner_count BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS giveaways_single_active_idx
  ON giveaways ((status)) WHERE status = 'active';

INSERT INTO giveaways (name, status, activated_at)
SELECT 'Sorteo actual', 'active', NOW()
WHERE NOT EXISTS (SELECT 1 FROM giveaways);

ALTER TABLE giveaway_participants
  ADD COLUMN IF NOT EXISTS giveaway_id BIGINT REFERENCES giveaways(id) ON DELETE CASCADE;

UPDATE giveaway_participants
SET giveaway_id = (SELECT id FROM giveaways ORDER BY created_at, id LIMIT 1)
WHERE giveaway_id IS NULL;

ALTER TABLE giveaway_participants
  ALTER COLUMN giveaway_id SET NOT NULL;

DROP INDEX IF EXISTS giveaway_participants_platform_username_idx;

CREATE UNIQUE INDEX IF NOT EXISTS giveaway_participants_round_username_idx
  ON giveaway_participants (giveaway_id, LOWER(platform), LOWER(username));

CREATE INDEX IF NOT EXISTS giveaway_participants_giveaway_idx
  ON giveaway_participants (giveaway_id);

CREATE TABLE IF NOT EXISTS giveaway_winners (
  id BIGSERIAL PRIMARY KEY,
  giveaway_id BIGINT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  participant_id BIGINT NOT NULL REFERENCES giveaway_participants(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 100),
  notes TEXT,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (giveaway_id, position),
  UNIQUE (giveaway_id, participant_id)
);
