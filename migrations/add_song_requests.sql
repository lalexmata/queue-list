CREATE TABLE IF NOT EXISTS song_requests (
  id BIGSERIAL PRIMARY KEY,
  youtube_id VARCHAR(11) NOT NULL,
  youtube_url TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  requested_by TEXT NOT NULL,
  requester_display_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'twitch',
  sort_order BIGINT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'playing', 'played', 'skipped')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS song_requests_active_order_idx
  ON song_requests (status, requested_at, id);

ALTER TABLE song_requests
  ADD COLUMN IF NOT EXISTS sort_order BIGINT;

UPDATE song_requests SET sort_order = id WHERE sort_order IS NULL;

CREATE INDEX IF NOT EXISTS song_requests_queue_order_idx
  ON song_requests (status, sort_order, requested_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS song_requests_unique_active_video_idx
  ON song_requests (youtube_id)
  WHERE status IN ('queued', 'playing');

CREATE TABLE IF NOT EXISTS song_request_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fallback_playlist_id TEXT,
  fallback_playlist_url TEXT,
  playback_volume SMALLINT NOT NULL DEFAULT 100 CHECK (playback_volume BETWEEN 0 AND 100),
  playback_paused BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE song_request_settings
  ADD COLUMN IF NOT EXISTS playback_volume SMALLINT NOT NULL DEFAULT 100
  CHECK (playback_volume BETWEEN 0 AND 100);

ALTER TABLE song_request_settings
  ADD COLUMN IF NOT EXISTS playback_paused BOOLEAN NOT NULL DEFAULT false;

INSERT INTO song_request_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
