const { pool } = require("../database/db");

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
            birthday_channel_id AS "birthdayChannelId", admin_role_id AS "adminRoleId", timezone,
            fortnite_enabled AS "fortniteEnabled", birthdays_enabled AS "birthdaysEnabled",
            giveaway_active AS "giveawayActive"
     FROM discord_guild_settings WHERE guild_id = $1`, [String(guildId)]
  );
  return rows[0] || null;
}

async function listGuildSettings() {
  const { rows } = await pool.query(
    `SELECT guild_id AS "guildId", COALESCE(guild_name, guild_id) AS "guildName",
            giveaway_active AS "giveawayActive", allowed_channel_id AS "allowedChannelId"
     FROM discord_guild_settings
     ORDER BY LOWER(COALESCE(guild_name, guild_id))`
  );
  return rows;
}

async function updateGuildSettings(guildId, changes) {
  await ensureGuild({ guildId });
  const allowed = ["allowedChannelId", "birthdayChannelId", "adminRoleId", "timezone", "giveawayActive"];
  const columns = { allowedChannelId: "allowed_channel_id", birthdayChannelId: "birthday_channel_id", adminRoleId: "admin_role_id", timezone: "timezone", giveawayActive: "giveaway_active" };
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

async function saveBirthday({ guildId, discordUserId, day, month, year = null }) {
  await ensureGuild({ guildId });
  const date = new Date(Date.UTC(year || 2000, Number(month) - 1, Number(day)));
  if (date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) {
    throw Object.assign(new Error("invalid_birthday"), { status: 400 });
  }
  const { rows } = await pool.query(
    `INSERT INTO discord_birthdays (guild_id, discord_user_id, birth_day, birth_month, birth_year)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id, discord_user_id) DO UPDATE
       SET birth_day = EXCLUDED.birth_day, birth_month = EXCLUDED.birth_month, birth_year = EXCLUDED.birth_year, updated_at = NOW()
     RETURNING birth_day AS day, birth_month AS month, birth_year AS year`,
    [String(guildId), String(discordUserId), Number(day), Number(month), year ? Number(year) : null]
  );
  return rows[0];
}

async function getBirthday(guildId, discordUserId) {
  const { rows } = await pool.query(
    `SELECT birth_day AS day, birth_month AS month, birth_year AS year
     FROM discord_birthdays WHERE guild_id = $1 AND discord_user_id = $2`,
    [String(guildId), String(discordUserId)]
  );
  return rows[0] || null;
}

async function listBirthdays(guildId) {
  const { rows } = await pool.query(
    `SELECT discord_user_id AS "discordUserId", birth_day AS day, birth_month AS month
     FROM discord_birthdays
     WHERE guild_id = $1
     ORDER BY birth_month, birth_day, discord_user_id`,
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
     SELECT b.guild_id, b.discord_user_id, $4::date
     FROM discord_birthdays b
     WHERE b.guild_id = $1 AND b.birth_month = $2 AND b.birth_day = $3
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
  claimBirthdayAnnouncements, releaseBirthdayAnnouncement,
  linkCouponAccount, getCouponAccount, getDiscordUsersForTwitch,
};
