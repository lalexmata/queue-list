BEGIN;
ALTER TABLE giveaway_coupon_sources
  DROP CONSTRAINT IF EXISTS giveaway_coupon_sources_source_check;
ALTER TABLE giveaway_coupon_sources
  ADD CONSTRAINT giveaway_coupon_sources_source_check
  CHECK (source IN ('channel_points', 'subscriber', 'subscriber_sum', 'gifted_subs', 'bits', 'purchase'));
COMMIT;
