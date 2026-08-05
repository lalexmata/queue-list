const { pool } = require("../database/db");
const { findOrCreateCommunityProfile } = require("./community-profile.service");

async function ensureGuild({ guildId, guildName = null }) {
  const { rows } = await pool.query(
    `INSERT INTO discord_guild_settings (guild_id, guild_name)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET guild_name = COALESCE(EXCLUDED.guild_name, discord_guild_settings.guild_name), updated_at = NOW()
     RETURNING *`, [String(guildId), guildName]
  );
  return rows[0];
}

async function getGuildSettings(guildId) {
  const { rows } = await pool.query(
    `SELECT guild_id AS "guildId", guild_name AS "guildName", allowed_channel_id AS "allowedChannelId",
            birthday_channel_id AS "birthdayChannelId", welcome_channel_id AS "welcomeChannelId",
            admin_role_id AS "adminRoleId", timezone,
            fortnite_enabled AS "fortniteEnabled", birthdays_enabled AS "birthdaysEnabled",
            giveaway_active AS "giveawayActive"
     FROM discord_guild_settings WHERE guild_id = $1`, [String(guildId)]
  );
  return rows[0] || null;
}

async function listGuildSettings() {
  const { rows } = await pool.query(
    `SELECT guild_id AS "guildId", COALESCE(guild_name, guild_id) AS "guildName",
            giveaway_active AS "giveawayActive", allowed_channel_id AS "allowedChannelId",
            welcome_channel_id AS "welcomeChannelId", birthday_channel_id AS "birthdayChannelId"
     FROM discord_guild_settings
     ORDER BY LOWER(COALESCE(guild_name, guild_id))`
  );
  return rows;
}

async function updateGuildSettings(guildId, changes) {
  await ensureGuild({ guildId });
  const allowed = ["allowedChannelId", "birthdayChannelId", "welcomeChannelId", "adminRoleId", "timezone", "giveawayActive"];
  const columns = { allowedChannelId: "allowed_channel_id", birthdayChannelId: "birthday_channel_id", welcomeChannelId: "welcome_channel_id", adminRoleId: "admin_role_id", timezone: "timezone", giveawayActive: "giveaway_active" };
  const entries = allowed.filter(key => changes[key] !== undefined);
  if (!entries.length) return getGuildSettings(guildId);
  const values = entries.map(key => changes[key] ?? null);
  const sets = entries.map((key, index) => `${columns[key]} = $${index + 2}`);
  await pool.query(`UPDATE discord_guild_settings SET ${sets.join(", ")}, updated_at = NOW() WHERE guild_id = $1`, [String(guildId), ...values]);
  return getGuildSettings(guildId);
}

async function linkFortniteAccount({ guildId, discordUserId, epicName, epicAccountId = null }) {
  await ensureGuild({ guildId });
  const { rows } = await pool.query(
    `INSERT INTO fortnite_accounts (guild_id, discord_user_id, epic_name, epic_account_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, discord_user_id) DO UPDATE
       SET epic_name = EXCLUDED.epic_name, epic_account_id = EXCLUDED.epic_account_id, updated_at = NOW()
     RETURNING epic_name AS "epicName", epic_account_id AS "epicAccountId"`,
    [String(guildId), String(discordUserId), String(epicName).trim(), epicAccountId]
  );
  const profileId = await findOrCreateCommunityProfile(pool, {
    platform: "discord", userId: discordUserId, displayName: discordUserId, communityId: guildId,
  });
  await pool.query(
    `INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
     VALUES ($1, 'epic', '', $2, $3)
     ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE
       SET profile_id = EXCLUDED.profile_id, display_name = EXCLUDED.display_name, updated_at = NOW()`,
    [profileId, String(epicName).trim().toLowerCase(), String(epicName).trim()]
  );
  return rows[0];
}

async function getFortniteAccount(guildId, discordUserId) {
  const { rows } = await pool.query(
    `SELECT epic_name AS "epicName", epic_account_id AS "epicAccountId"
     FROM fortnite_accounts WHERE guild_id = $1 AND discord_user_id = $2`,
    [String(guildId), String(discordUserId)]
  );
  return rows[0] || null;
}

async function saveBirthday({ guildId, discordUserId, displayName = null, day, month, year = null }) {
  await ensureGuild({ guildId });
  return savePlatformBirthday({
    platform: "discord", userId: discordUserId, communityId: guildId, displayName, day, month, year,
  });
}

async function listDiscordIdentitiesNeedingNames() {
  const { rows } = await pool.query(
    `SELECT community_id AS "guildId", platform_user_id AS "discordUserId"
     FROM community_identities
     WHERE platform = 'discord' AND display_name = platform_user_id`
  );
  return rows;
}

async function updateDiscordIdentityName({ guildId, discordUserId, displayName }) {
  const name = String(displayName || "").trim().slice(0, 100);
  if (!name) return null;
  const { rows } = await pool.query(
    `UPDATE community_identities i SET display_name = $3, updated_at = NOW()
     WHERE i.platform = 'discord' AND i.community_id = $1 AND i.platform_user_id = $2
     RETURNING i.profile_id AS "profileId"`,
    [String(guildId), String(discordUserId), name]
  );
  if (rows[0]) {
    await pool.query(
      `UPDATE community_profiles SET display_name = $2, updated_at = NOW()
       WHERE id = $1 AND (display_name IS NULL OR display_name ~ '^\\d+$')`,
      [rows[0].profileId, name]
    );
  }
  return rows[0] || null;
}

async function getBirthday(guildId, discordUserId) {
  return getPlatformBirthday({ platform: "discord", userId: discordUserId, communityId: guildId });
}

async function listBirthdays(guildId) {
  const { rows } = await pool.query(
    `SELECT p.id AS "profileId", p.display_name AS "displayName",
            p.birth_day AS day, p.birth_month AS month,
            (SELECT d.platform_user_id FROM community_identities d
             WHERE d.profile_id = p.id AND d.platform = 'discord' AND d.community_id = $1
             ORDER BY d.created_at LIMIT 1) AS "discordUserId",
            (SELECT i.platform FROM community_identities i WHERE i.profile_id = p.id
             ORDER BY CASE i.platform WHEN 'twitch' THEN 0 WHEN 'youtube' THEN 1 WHEN 'kick' THEN 2 ELSE 3 END,
                      i.created_at LIMIT 1) AS platform,
            (SELECT COALESCE(i.display_name, i.platform_user_id) FROM community_identities i WHERE i.profile_id = p.id
             ORDER BY CASE i.platform WHEN 'twitch' THEN 0 WHEN 'youtube' THEN 1 WHEN 'kick' THEN 2 ELSE 3 END,
                      i.created_at LIMIT 1) AS "identityName"
     FROM community_profiles p
     WHERE p.birth_month IS NOT NULL AND p.birth_day IS NOT NULL
       AND (EXISTS (SELECT 1 FROM community_identities d
                    WHERE d.profile_id = p.id AND d.platform = 'discord' AND d.community_id = $1)
            OR NOT EXISTS (SELECT 1 FROM community_identities d
                           WHERE d.profile_id = p.id AND d.platform = 'discord'))
     ORDER BY p.birth_month, p.birth_day, LOWER(COALESCE(p.display_name, ''))`,
    [String(guildId)]
  );
  return rows;
}

async function listBirthdayGuilds() {
  const { rows } = await pool.query(
    `SELECT guild_id AS "guildId", COALESCE(birthday_channel_id, allowed_channel_id) AS "channelId", timezone
     FROM discord_guild_settings
     WHERE birthdays_enabled = TRUE
       AND COALESCE(birthday_channel_id, allowed_channel_id) IS NOT NULL`
  );
  return rows;
}

async function claimBirthdayAnnouncements({ guildId, year, month, day }) {
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const { rows } = await pool.query(
    `INSERT INTO birthday_announcements (guild_id, discord_user_id, announcement_date)
     SELECT i.community_id, i.platform_user_id, $4::date
     FROM community_identities i
     JOIN community_profiles p ON p.id = i.profile_id
     WHERE i.platform = 'discord' AND i.community_id = $1
       AND p.birth_month = $2 AND p.birth_day = $3
     ON CONFLICT (guild_id, discord_user_id, announcement_date) DO NOTHING
     RETURNING discord_user_id AS "discordUserId"`,
    [String(guildId), Number(month), Number(day), date]
  );
  return { date, users: rows };
}

async function releaseBirthdayAnnouncement(guildId, discordUserId, date) {
  await pool.query(
    `DELETE FROM birthday_announcements
     WHERE guild_id = $1 AND discord_user_id = $2 AND announcement_date = $3::date`,
    [String(guildId), String(discordUserId), date]
  );
}

function cleanTwitchUsername(value) {
  const username = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(username)) {
    throw Object.assign(new Error("invalid_twitch_username"), { status: 400 });
  }
  return username;
}

const BIRTHDAY_PLATFORMS = new Set(["discord", "twitch", "youtube", "kick"]);
const BIRTHDAY_MONTHS = new Map([
  ["enero", 1], ["ene", 1], ["febrero", 2], ["feb", 2], ["marzo", 3], ["mar", 3],
  ["abril", 4], ["abr", 4], ["mayo", 5], ["may", 5], ["junio", 6], ["jun", 6],
  ["julio", 7], ["jul", 7], ["agosto", 8], ["ago", 8],
  ["septiembre", 9], ["setiembre", 9], ["sep", 9], ["sept", 9], ["set", 9],
  ["octubre", 10], ["oct", 10], ["noviembre", 11], ["nov", 11],
  ["diciembre", 12], ["dic", 12],
]);

function parseBirthdayMonth(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) return numeric;
  const normalized = String(value || "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\./g, "");
  return BIRTHDAY_MONTHS.get(normalized) || NaN;
}

function cleanBirthdayIdentity(platformValue, userIdValue) {
  const platform = String(platformValue || "").trim().toLowerCase();
  if (!BIRTHDAY_PLATFORMS.has(platform)) {
    throw Object.assign(new Error("invalid_birthday_platform"), { status: 400 });
  }
  let userId = String(userIdValue || "").trim();
  if (platform === "twitch" || platform === "kick") userId = userId.replace(/^@+/, "").toLowerCase();
  const valid = platform === "discord" ? /^\d{1,30}$/.test(userId)
    : platform === "twitch" ? /^[a-z0-9_]{1,25}$/.test(userId)
      : platform === "kick" ? /^[a-z0-9_-]{1,30}$/.test(userId)
        : /^[a-zA-Z0-9_@.-]{1,100}$/.test(userId);
  if (!valid) throw Object.assign(new Error("invalid_birthday_user"), { status: 400 });
  return { platform, userId };
}

function validateBirthday(day, month, year = null) {
  const numericDay = Number(day);
  const numericMonth = parseBirthdayMonth(month);
  const numericYear = year ? Number(year) : null;
  if (numericYear !== null && (!Number.isInteger(numericYear) || numericYear < 1900 || numericYear > 2100)) {
    throw Object.assign(new Error("invalid_birthday"), { status: 400 });
  }
  const date = new Date(Date.UTC(numericYear || 2000, numericMonth - 1, numericDay));
  if (!Number.isInteger(numericDay) || !Number.isInteger(numericMonth)
    || date.getUTCMonth() + 1 !== numericMonth || date.getUTCDate() !== numericDay) {
    throw Object.assign(new Error("invalid_birthday"), { status: 400 });
  }
  return { day: numericDay, month: numericMonth, year: numericYear };
}

async function savePlatformBirthday({
  platform: rawPlatform, userId: rawUserId, communityId = "", displayName,
  day, month, year = null, profileId = null,
}) {
  const { platform, userId } = cleanBirthdayIdentity(rawPlatform, rawUserId);
  const birthday = validateBirthday(day, month, year);
  const scopedCommunityId = String(communityId || "").trim();
  if (platform === "discord" && !scopedCommunityId) {
    throw Object.assign(new Error("birthday_community_required"), { status: 400 });
  }
  const visibleName = String(displayName || rawUserId || userId).trim().replace(/^@+/, "").slice(0, 100) || userId;
  const requestedProfileId = profileId === null || profileId === undefined ? null : Number(profileId);
  if (requestedProfileId !== null && (!Number.isSafeInteger(requestedProfileId) || requestedProfileId < 1)) {
    throw Object.assign(new Error("invalid_birthday_profile"), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identityResult = await client.query(
      `SELECT profile_id AS "profileId" FROM community_identities
       WHERE platform = $1 AND community_id = $2 AND platform_user_id = $3
       FOR UPDATE`,
      [platform, scopedCommunityId, userId]
    );
    const sameAccountResult = identityResult.rows.length ? identityResult : await client.query(
      `SELECT profile_id AS "profileId" FROM community_identities
       WHERE LOWER(REGEXP_REPLACE(platform_user_id, '[^a-z0-9]', '', 'g')) =
             LOWER(REGEXP_REPLACE($1, '[^a-z0-9]', '', 'g'))
       ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [userId]
    );
    const previousProfileId = identityResult.rows[0]?.profileId || null;
    const knownAccountProfileId = sameAccountResult.rows[0]?.profileId || null;
    let targetProfileId = requestedProfileId || knownAccountProfileId;

    if (requestedProfileId) {
      const target = await client.query("SELECT id FROM community_profiles WHERE id = $1 FOR UPDATE", [requestedProfileId]);
      if (!target.rows.length) throw Object.assign(new Error("birthday_profile_not_found"), { status: 404 });
    }
    if (!targetProfileId) {
      const created = await client.query(
        `INSERT INTO community_profiles (display_name, birth_day, birth_month, birth_year)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [visibleName, birthday.day, birthday.month, birthday.year]
      );
      targetProfileId = created.rows[0].id;
    } else {
      await client.query(
        `UPDATE community_profiles SET display_name = CASE
           WHEN display_name IS NULL OR display_name ~ '^\\d+$' THEN $5 ELSE display_name END,
         birth_day = $2, birth_month = $3, birth_year = $4, updated_at = NOW()
         WHERE id = $1`,
        [targetProfileId, birthday.day, birthday.month, birthday.year, visibleName]
      );
    }

    await client.query(
      `INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE
         SET profile_id = EXCLUDED.profile_id, display_name = EXCLUDED.display_name, updated_at = NOW()`,
      [targetProfileId, platform, scopedCommunityId, userId, visibleName]
    );
    if (previousProfileId && previousProfileId !== targetProfileId) {
      await client.query(
        `DELETE FROM community_profiles p WHERE p.id = $1
         AND NOT EXISTS (SELECT 1 FROM community_identities i WHERE i.profile_id = p.id)`,
        [previousProfileId]
      );
    }
    await client.query("COMMIT");
    const profile = await getBirthdayProfile(targetProfileId, client);
    return { ...profile, platform, communityId: scopedCommunityId, userId, displayName: visibleName };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getPlatformBirthday({ platform: rawPlatform, userId: rawUserId, communityId = "" }) {
  const { platform, userId } = cleanBirthdayIdentity(rawPlatform, rawUserId);
  const scope = String(communityId || "").trim();
  const { rows } = await pool.query(
    `SELECT i.profile_id AS "profileId", i.platform, i.community_id AS "communityId",
            i.platform_user_id AS "userId", i.display_name AS "displayName",
            p.birth_day AS day, p.birth_month AS month, p.birth_year AS year,
            (SELECT COUNT(*)::int FROM community_identities all_i WHERE all_i.profile_id = i.profile_id) AS "identityCount",
            EXISTS (SELECT 1 FROM community_identities other_i
                    WHERE other_i.profile_id = i.profile_id AND other_i.platform <> i.platform) AS "hasOtherPlatforms",
            (i.platform = 'discord' AND i.display_name = i.platform_user_id) AS "unresolvedDisplayName"
     FROM community_identities i
     JOIN community_profiles p ON p.id = i.profile_id
     WHERE i.platform = $1 AND ($2 = '' OR i.community_id = $2) AND i.platform_user_id = $3
     ORDER BY CASE WHEN i.community_id = $2 THEN 0 ELSE 1 END, i.created_at
     LIMIT 1`,
    [platform, scope, userId]
  );
  return rows[0] || null;
}

async function getBirthdayProfile(rawProfileId, queryable = pool) {
  const profileId = Number(rawProfileId);
  if (!Number.isSafeInteger(profileId) || profileId < 1) {
    throw Object.assign(new Error("invalid_birthday_profile"), { status: 400 });
  }
  const { rows } = await queryable.query(
    `SELECT p.id AS "profileId", p.birth_day AS day, p.birth_month AS month, p.birth_year AS year,
            COALESCE(json_agg(json_build_object(
              'platform', i.platform, 'communityId', i.community_id, 'userId', i.platform_user_id,
              'displayName', i.display_name
            ) ORDER BY i.platform, LOWER(i.display_name)) FILTER (WHERE i.profile_id IS NOT NULL), '[]') AS identities
     FROM community_profiles p
     LEFT JOIN community_identities i ON i.profile_id = p.id
     WHERE p.id = $1
     GROUP BY p.id`,
    [profileId]
  );
  return rows[0] || null;
}

async function listPlatformBirthdaysByMonth({ platform: rawPlatform, communityId = "", month, fromDay = 1 }) {
  const platform = String(rawPlatform || "").trim().toLowerCase();
  if (!BIRTHDAY_PLATFORMS.has(platform)) {
    throw Object.assign(new Error("invalid_birthday_platform"), { status: 400 });
  }
  const numericMonth = parseBirthdayMonth(month);
  const numericDay = Number(fromDay);
  if (!Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12
    || !Number.isInteger(numericDay) || numericDay < 1 || numericDay > 31) {
    throw Object.assign(new Error("invalid_birthday_query"), { status: 400 });
  }
  const { rows } = await pool.query(
    `SELECT i.profile_id AS "profileId", i.platform, i.community_id AS "communityId",
            i.platform_user_id AS "userId", i.display_name AS "displayName",
            p.birth_day AS day, p.birth_month AS month,
            (SELECT COUNT(*)::int FROM community_identities all_i WHERE all_i.profile_id = i.profile_id) AS "identityCount",
            EXISTS (SELECT 1 FROM community_identities other_i
                    WHERE other_i.profile_id = i.profile_id AND other_i.platform <> i.platform) AS "hasOtherPlatforms",
            (i.platform = 'discord' AND i.display_name = i.platform_user_id) AS "unresolvedDisplayName"
     FROM community_identities i
     JOIN community_profiles p ON p.id = i.profile_id
     WHERE i.platform = $1 AND ($2 = '' OR i.community_id = $2) AND p.birth_month = $3 AND p.birth_day >= $4
     ORDER BY p.birth_day, LOWER(i.display_name), i.platform_user_id`,
    [platform, String(communityId || "").trim(), numericMonth, numericDay]
  );
  return rows;
}

async function linkCouponAccount({ guildId, discordUserId, twitchUsername }) {
  await ensureGuild({ guildId });
  const username = cleanTwitchUsername(twitchUsername);
  const { rows } = await pool.query(
    `INSERT INTO discord_coupon_accounts (guild_id, discord_user_id, twitch_username)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, discord_user_id) DO UPDATE
       SET twitch_username = EXCLUDED.twitch_username, updated_at = NOW()
     RETURNING twitch_username AS "twitchUsername"`,
    [String(guildId), String(discordUserId), username]
  );
  return rows[0];
}

async function getCouponAccount(guildId, discordUserId) {
  const { rows } = await pool.query(
    `SELECT twitch_username AS "twitchUsername"
     FROM discord_coupon_accounts WHERE guild_id = $1 AND discord_user_id = $2`,
    [String(guildId), String(discordUserId)]
  );
  return rows[0] || null;
}

async function getDiscordUsersForTwitch(guildId, usernames) {
  const normalized = [...new Set((usernames || []).map(cleanTwitchUsername))];
  if (!normalized.length) return new Map();
  const { rows } = await pool.query(
    `SELECT discord_user_id AS "discordUserId", twitch_username AS "twitchUsername"
     FROM discord_coupon_accounts
     WHERE guild_id = $1 AND LOWER(twitch_username) = ANY($2::text[])`,
    [String(guildId), normalized]
  );
  return new Map(rows.map(row => [row.twitchUsername.toLowerCase(), row.discordUserId]));
}

module.exports = {
  ensureGuild, getGuildSettings, listGuildSettings, updateGuildSettings, linkFortniteAccount, getFortniteAccount,
  saveBirthday, getBirthday, listBirthdays, listBirthdayGuilds,
  listDiscordIdentitiesNeedingNames, updateDiscordIdentityName,
  claimBirthdayAnnouncements, releaseBirthdayAnnouncement,
  linkCouponAccount, getCouponAccount, getDiscordUsersForTwitch,
  savePlatformBirthday, getPlatformBirthday, getBirthdayProfile, listPlatformBirthdaysByMonth,
  parseBirthdayMonth,
};
