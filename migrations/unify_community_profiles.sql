CREATE TABLE IF NOT EXISTS community_profiles (
  id BIGSERIAL PRIMARY KEY,
  display_name TEXT,
  notes TEXT,
  birth_month SMALLINT CHECK (birth_month BETWEEN 1 AND 12),
  birth_day SMALLINT CHECK (birth_day BETWEEN 1 AND 31),
  birth_year SMALLINT CHECK (birth_year BETWEEN 1900 AND 2100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((birth_month IS NULL) = (birth_day IS NULL))
);

CREATE TABLE IF NOT EXISTS community_identities (
  profile_id BIGINT NOT NULL REFERENCES community_profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'twitch', 'youtube', 'kick', 'epic', 'tiktok', 'facebook', 'instagram', 'other')),
  community_id TEXT NOT NULL DEFAULT '',
  platform_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform, community_id, platform_user_id)
);

CREATE INDEX IF NOT EXISTS community_profiles_date_idx ON community_profiles (birth_month, birth_day);
CREATE INDEX IF NOT EXISTS community_identities_profile_idx ON community_identities (profile_id);
CREATE INDEX IF NOT EXISTS community_identities_search_idx ON community_identities (LOWER(platform_user_id), LOWER(display_name));

ALTER TABLE giveaway_participants ADD COLUMN IF NOT EXISTS profile_id BIGINT REFERENCES community_profiles(id) ON DELETE SET NULL;

DO $$
DECLARE source RECORD; selected_profile BIGINT; secondary_profile BIGINT;
BEGIN
  IF to_regclass('public.discord_birthdays') IS NOT NULL THEN
    FOR source IN EXECUTE 'SELECT * FROM discord_birthdays' LOOP
      SELECT profile_id INTO selected_profile FROM community_identities
       WHERE platform = 'discord' AND platform_user_id = source.discord_user_id LIMIT 1;
      IF selected_profile IS NULL THEN
        INSERT INTO community_profiles (display_name, birth_month, birth_day, birth_year, created_at, updated_at)
        VALUES (source.discord_user_id, source.birth_month, source.birth_day, source.birth_year, source.created_at, source.updated_at)
        RETURNING id INTO selected_profile;
      END IF;
      INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
      VALUES (selected_profile, 'discord', source.guild_id, source.discord_user_id, source.discord_user_id)
      ON CONFLICT (platform, community_id, platform_user_id) DO NOTHING;
    END LOOP;
  END IF;

  IF to_regclass('public.twitch_birthdays') IS NOT NULL THEN
    FOR source IN EXECUTE 'SELECT * FROM twitch_birthdays' LOOP
      SELECT profile_id INTO selected_profile FROM community_identities
       WHERE platform = 'twitch' AND platform_user_id = source.twitch_username LIMIT 1;
      IF selected_profile IS NULL THEN
        INSERT INTO community_profiles (display_name, birth_month, birth_day, birth_year, created_at, updated_at)
        VALUES (source.display_name, source.birth_month, source.birth_day, source.birth_year, source.created_at, source.updated_at)
        RETURNING id INTO selected_profile;
      END IF;
      INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
      VALUES (selected_profile, 'twitch', '', source.twitch_username, source.display_name)
      ON CONFLICT (platform, community_id, platform_user_id) DO NOTHING;
    END LOOP;
  END IF;

  IF to_regclass('public.discord_coupon_accounts') IS NOT NULL THEN
    FOR source IN EXECUTE 'SELECT * FROM discord_coupon_accounts' LOOP
      SELECT profile_id INTO selected_profile FROM community_identities
       WHERE platform = 'discord' AND platform_user_id = source.discord_user_id LIMIT 1;
      SELECT profile_id INTO secondary_profile FROM community_identities
       WHERE platform = 'twitch' AND LOWER(platform_user_id) = LOWER(source.twitch_username) LIMIT 1;
      IF selected_profile IS NULL THEN selected_profile := secondary_profile; END IF;
      IF selected_profile IS NULL THEN
        INSERT INTO community_profiles (display_name) VALUES (source.twitch_username) RETURNING id INTO selected_profile;
      END IF;
      IF secondary_profile IS NOT NULL AND secondary_profile <> selected_profile THEN
        UPDATE community_identities SET profile_id = selected_profile WHERE profile_id = secondary_profile;
        IF to_regclass('public.giveaway_participants') IS NOT NULL THEN
          EXECUTE 'UPDATE giveaway_participants SET profile_id = $1 WHERE profile_id = $2' USING selected_profile, secondary_profile;
        END IF;
        DELETE FROM community_profiles WHERE id = secondary_profile;
      END IF;
      INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
      VALUES (selected_profile, 'discord', source.guild_id, source.discord_user_id, source.discord_user_id)
      ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE SET profile_id = EXCLUDED.profile_id;
      INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
      VALUES (selected_profile, 'twitch', '', LOWER(source.twitch_username), source.twitch_username)
      ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE SET profile_id = EXCLUDED.profile_id;
    END LOOP;
  END IF;
END $$;

DO $$
DECLARE participant RECORD; selected_profile BIGINT;
BEGIN
  FOR participant IN SELECT * FROM giveaway_participants WHERE profile_id IS NULL LOOP
    SELECT profile_id INTO selected_profile FROM community_identities
     WHERE LOWER(platform) = LOWER(participant.platform)
       AND LOWER(platform_user_id) = LOWER(participant.username) LIMIT 1;
    IF selected_profile IS NULL THEN
      INSERT INTO community_profiles (display_name) VALUES (participant.display_name) RETURNING id INTO selected_profile;
      INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
      VALUES (selected_profile, LOWER(participant.platform), '', LOWER(participant.username), participant.display_name)
      ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE SET profile_id = EXCLUDED.profile_id;
    END IF;
    UPDATE giveaway_participants SET profile_id = selected_profile WHERE id = participant.id;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS giveaway_participants_profile_idx ON giveaway_participants (profile_id);

ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS profile_id BIGINT REFERENCES community_profiles(id) ON DELETE SET NULL;
ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS profile_id BIGINT REFERENCES community_profiles(id) ON DELETE SET NULL;

DO $$
DECLARE source RECORD; selected_profile BIGINT; normalized_platform TEXT;
BEGIN
  FOR source IN SELECT * FROM song_requests WHERE profile_id IS NULL AND LOWER(platform) <> 'admin' LOOP
    normalized_platform := CASE WHEN LOWER(source.platform) IN ('discord','twitch','youtube','kick','tiktok','facebook','instagram')
      THEN LOWER(source.platform) ELSE 'other' END;
    SELECT profile_id INTO selected_profile FROM community_identities
     WHERE platform = normalized_platform AND LOWER(platform_user_id) = LOWER(source.requested_by) LIMIT 1;
    IF selected_profile IS NULL THEN
      INSERT INTO community_profiles (display_name) VALUES (source.requester_display_name) RETURNING id INTO selected_profile;
      INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
      VALUES (selected_profile, normalized_platform, '', LOWER(source.requested_by), source.requester_display_name)
      ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE SET profile_id = EXCLUDED.profile_id;
    END IF;
    UPDATE song_requests SET profile_id = selected_profile WHERE id = source.id;
  END LOOP;

  FOR source IN SELECT * FROM queue_items WHERE profile_id IS NULL LOOP
    normalized_platform := CASE WHEN LOWER(source.platform) IN ('discord','twitch','youtube','kick','tiktok','facebook','instagram')
      THEN LOWER(source.platform) ELSE 'other' END;
    SELECT profile_id INTO selected_profile FROM community_identities
     WHERE platform = normalized_platform AND LOWER(platform_user_id) = LOWER(source.unique_id) LIMIT 1;
    IF selected_profile IS NULL THEN
      INSERT INTO community_profiles (display_name) VALUES (source.nickname) RETURNING id INTO selected_profile;
      INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
      VALUES (selected_profile, normalized_platform, '', LOWER(source.unique_id), source.nickname)
      ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE SET profile_id = EXCLUDED.profile_id;
    END IF;
    UPDATE queue_items SET profile_id = selected_profile WHERE id = source.id;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS song_requests_profile_idx ON song_requests (profile_id);
CREATE INDEX IF NOT EXISTS queue_items_profile_idx ON queue_items (profile_id);
