ALTER TABLE song_requests
  ADD COLUMN IF NOT EXISTS sort_order BIGINT;

UPDATE song_requests
SET sort_order = id
WHERE sort_order IS NULL;

CREATE INDEX IF NOT EXISTS song_requests_queue_order_idx
  ON song_requests (status, sort_order, requested_at, id);
