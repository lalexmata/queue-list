ALTER TABLE community_identities
  DROP CONSTRAINT IF EXISTS community_identities_platform_check;

ALTER TABLE community_identities
  ADD CONSTRAINT community_identities_platform_check
  CHECK (platform IN ('discord', 'twitch', 'youtube', 'kick', 'epic', 'tiktok', 'facebook', 'instagram', 'other'));

DO $$
DECLARE account RECORD; selected_profile BIGINT;
BEGIN
  IF to_regclass('public.fortnite_accounts') IS NULL THEN RETURN; END IF;

  FOR account IN SELECT * FROM fortnite_accounts LOOP
    SELECT profile_id INTO selected_profile
      FROM community_identities
     WHERE platform = 'discord'
       AND community_id = account.guild_id
       AND platform_user_id = account.discord_user_id
     LIMIT 1;

    IF selected_profile IS NULL THEN
      INSERT INTO community_profiles (display_name)
      VALUES (account.discord_user_id)
      RETURNING id INTO selected_profile;

      INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
      VALUES (selected_profile, 'discord', account.guild_id, account.discord_user_id, account.discord_user_id)
      ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE
        SET profile_id = EXCLUDED.profile_id, updated_at = NOW();
    END IF;

    INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
    VALUES (selected_profile, 'epic', '', LOWER(account.epic_name), account.epic_name)
    ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE
      SET profile_id = EXCLUDED.profile_id, display_name = EXCLUDED.display_name, updated_at = NOW();
  END LOOP;
END $$;
