const { pool } = require("../database/db");

function profileId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error("invalid_community_profile"), { status: 400 });
  return id;
}

const IDENTITY_PLATFORMS = new Set(["discord", "twitch", "youtube", "kick", "epic", "tiktok", "facebook", "instagram", "other", "unknown"]);

function cleanAliases(value) {
  const entries = Array.isArray(value) ? value : String(value || "").split(/[,\n]/);
  const unique = new Map();
  for (const entry of entries) {
    const alias = String(entry || "").trim().slice(0, 100);
    if (alias) unique.set(alias.toLowerCase(), alias);
  }
  return [...unique.values()].slice(0, 20);
}

async function moveProfileAliases(db, targetId, sourceId) {
  await db.query(
    `DELETE FROM community_profile_aliases source USING community_profile_aliases target
     WHERE source.profile_id = $2 AND target.profile_id = $1 AND LOWER(source.alias) = LOWER(target.alias)`,
    [targetId, sourceId]
  );
  await db.query("UPDATE community_profile_aliases SET profile_id = $1 WHERE profile_id = $2", [targetId, sourceId]);
}

async function findOrCreateCommunityProfile(db, { platform: rawPlatform, userId: rawUserId, displayName, communityId = "" }) {
  const platform = String(rawPlatform || "other").trim().toLowerCase();
  const userId = String(rawUserId || "").trim().replace(/^@+/, "").toLowerCase();
  if (!IDENTITY_PLATFORMS.has(platform) || !userId || userId.length > 100) {
    throw Object.assign(new Error("invalid_community_identity"), { status: 400 });
  }
  const visibleName = String(displayName || rawUserId || userId).trim().slice(0, 100) || userId;
  const scope = String(communityId || "").trim();
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`community:${platform}:${userId}`]);
  const { rows: existing } = await db.query(
    `SELECT profile_id AS "profileId" FROM community_identities
     WHERE platform = $1 AND LOWER(platform_user_id) = $2 ORDER BY created_at LIMIT 1`,
    [platform === "unknown" ? "other" : platform, userId]
  );
  let selectedId = existing[0]?.profileId;
  if (!selectedId) {
    const { rows: crossPlatform } = await db.query(
      `SELECT profile_id AS "profileId" FROM community_identities
       WHERE LOWER(REGEXP_REPLACE(platform_user_id, '[^a-z0-9]', '', 'g')) =
             LOWER(REGEXP_REPLACE($1, '[^a-z0-9]', '', 'g'))
       ORDER BY created_at LIMIT 1`,
      [userId]
    );
    selectedId = crossPlatform[0]?.profileId;
  }
  if (!selectedId) {
    const { rows } = await db.query("INSERT INTO community_profiles (display_name) VALUES ($1) RETURNING id", [visibleName]);
    selectedId = rows[0].id;
  }
  await db.query(
    `INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = NOW()`,
    [selectedId, platform === "unknown" ? "other" : platform, scope, userId, visibleName]
  );
  return selectedId;
}

async function searchCommunityProfiles(rawQuery, limit = 30) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2) throw Object.assign(new Error("invalid_profile_search"), { status: 400 });
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const { rows } = await pool.query(
    `SELECT p.id AS "profileId", p.display_name AS "displayName",
            p.birth_day AS day, p.birth_month AS month, p.birth_year AS year,
            COALESCE((SELECT JSON_AGG(a.alias ORDER BY LOWER(a.alias)) FROM community_profile_aliases a
                      WHERE a.profile_id = p.id), '[]') AS aliases,
            JSON_AGG(JSON_BUILD_OBJECT(
              'platform', i.platform, 'communityId', i.community_id,
              'communityName', CASE WHEN i.community_id <> '' THEN
                (SELECT guild_name FROM discord_guild_settings WHERE guild_id = i.community_id) ELSE NULL END,
              'userId', i.platform_user_id, 'displayName', i.display_name
            ) ORDER BY i.platform, LOWER(i.display_name)) AS identities
     FROM community_profiles p
     JOIN community_identities i ON i.profile_id = p.id
     WHERE p.display_name ILIKE $1 OR i.display_name ILIKE $1 OR i.platform_user_id ILIKE $1
        OR EXISTS (SELECT 1 FROM community_profile_aliases a WHERE a.profile_id = p.id AND a.alias ILIKE $1)
     GROUP BY p.id
     ORDER BY CASE WHEN LOWER(p.display_name) = LOWER($2) THEN 0
                   WHEN BOOL_OR(LOWER(i.platform_user_id) = LOWER($2)) THEN 1 ELSE 2 END,
              LOWER(COALESCE(p.display_name, MIN(i.display_name)))
     LIMIT $3`,
    [`%${query}%`, query, safeLimit]
  );
  return rows;
}

async function listRecentCommunityActivity(limit = 25) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT 'profile_created' AS type, p.id AS "profileId", p.display_name AS "displayName",
              NULL::text AS platform, NULL::text AS "identityName", p.created_at AS "occurredAt"
       FROM community_profiles p
       UNION ALL
       SELECT 'birthday_saved', p.id, p.display_name, NULL::text,
              CONCAT(LPAD(p.birth_day::text, 2, '0'), '/', LPAD(p.birth_month::text, 2, '0')), p.updated_at
       FROM community_profiles p WHERE p.birth_day IS NOT NULL AND p.birth_month IS NOT NULL
       UNION ALL
       SELECT CASE WHEN i.updated_at > i.created_at + INTERVAL '1 second' THEN 'identity_updated' ELSE 'identity_linked' END,
              p.id, p.display_name, i.platform, i.display_name, i.updated_at
       FROM community_identities i JOIN community_profiles p ON p.id = i.profile_id
     ) activity ORDER BY "occurredAt" DESC LIMIT $1`,
    [safeLimit]
  );
  return rows;
}

async function listBirthdaysForDate(day, month) {
  const { rows } = await pool.query(
    `SELECT p.id AS "profileId",
            COALESCE(NULLIF(p.display_name, ''),
              (SELECT NULLIF(i.display_name, '') FROM community_identities i
               WHERE i.profile_id = p.id ORDER BY i.created_at LIMIT 1),
              'Alguien de la comunidad') AS "displayName"
     FROM community_profiles p
     WHERE p.birth_day = $1 AND p.birth_month = $2
     ORDER BY LOWER(COALESCE(NULLIF(p.display_name, ''),
       (SELECT i.display_name FROM community_identities i
        WHERE i.profile_id = p.id ORDER BY i.created_at LIMIT 1), ''))`,
    [Number(day), Number(month)]
  );
  return rows;
}

async function createCommunityProfile(data = {}) {
  const displayName = String(data.displayName || "").trim().slice(0, 100);
  if (!displayName) throw Object.assign(new Error("invalid_community_profile"), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const platform = String(data.platform || "").trim().toLowerCase();
    const userId = String(data.userId || "").trim().replace(/^@+/, "").toLowerCase();
    const previous = await client.query(
      `SELECT profile_id AS "profileId" FROM community_identities
       WHERE platform = $1 AND LOWER(platform_user_id) = $2 LIMIT 1`,
      [platform, userId]
    );
    const selectedId = await findOrCreateCommunityProfile(client, {
      platform, userId, displayName: data.identityDisplayName || data.userId, communityId: data.communityId || "",
    });
    if (!previous.rows.length) {
      await client.query("UPDATE community_profiles SET display_name = $2, updated_at = NOW() WHERE id = $1", [selectedId, displayName]);
    }
    await client.query("COMMIT");
    return getCommunityProfile(selectedId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function getCommunityProfile(rawId) {
  const id = profileId(rawId);
  const { rows } = await pool.query(
    `SELECT p.id AS "profileId", p.display_name AS "displayName", p.notes,
            p.birth_day AS day, p.birth_month AS month, p.birth_year AS year,
            p.created_at AS "createdAt", p.updated_at AS "updatedAt",
            COALESCE((SELECT JSON_AGG(a.alias ORDER BY LOWER(a.alias)) FROM community_profile_aliases a
                      WHERE a.profile_id = p.id), '[]') AS aliases,
            COALESCE(JSON_AGG(JSON_BUILD_OBJECT(
              'platform', i.platform, 'communityId', i.community_id,
              'communityName', CASE WHEN i.community_id <> '' THEN
                (SELECT guild_name FROM discord_guild_settings WHERE guild_id = i.community_id) ELSE NULL END,
              'userId', i.platform_user_id, 'displayName', i.display_name
            ) ORDER BY i.platform, LOWER(i.display_name)) FILTER (WHERE i.profile_id IS NOT NULL), '[]') AS identities
     FROM community_profiles p
     LEFT JOIN community_identities i ON i.profile_id = p.id
     WHERE p.id = $1 GROUP BY p.id`,
    [id]
  );
  if (!rows[0]) return null;

  const { rows: giveaways } = await pool.query(
    `SELECT g.id AS "giveawayId", g.name, g.status, g.draw_at AS "drawAt",
            g.finished_at AS "finishedAt", p.platform, p.username,
            p.display_name AS "participantName",
            COALESCE(SUM(s.coupon_count), 0)::int AS "couponCount",
            w.position AS "winnerPosition", w.selected_at AS "wonAt", w.notes AS "winnerNotes"
     FROM giveaway_participants p
     JOIN giveaways g ON g.id = p.giveaway_id
     LEFT JOIN giveaway_coupon_sources s ON s.participant_id = p.id
     LEFT JOIN giveaway_winners w ON w.giveaway_id = g.id AND w.participant_id = p.id
     WHERE p.profile_id = $1
     GROUP BY g.id, p.id, w.id
     ORDER BY COALESCE(g.finished_at, g.draw_at, g.created_at) DESC, g.id DESC`,
    [id]
  );
  const { rows: songs } = await pool.query(
    `SELECT id, title, youtube_url AS "youtubeUrl", status, platform,
            requester_display_name AS "requesterDisplayName", requested_at AS "requestedAt"
     FROM song_requests WHERE profile_id = $1
     ORDER BY requested_at DESC, id DESC LIMIT 100`,
    [id]
  );
  const { rows: queue } = await pool.query(
    `SELECT unique_id AS "userId", nickname AS "displayName", platform, role,
            is_sub AS "isSubscriber", ts AS "joinedAt", position
     FROM queue_items WHERE profile_id = $1 ORDER BY ts DESC`,
    [id]
  );
  return {
    ...rows[0],
    summary: {
      giveawayParticipations: giveaways.length,
      giveawayWins: giveaways.filter(item => item.winnerPosition !== null).length,
      totalCoupons: giveaways.reduce((total, item) => total + Number(item.couponCount || 0), 0),
      songRequests: songs.length,
      currentlyInQueue: queue.length > 0,
    },
    giveaways,
    songs,
    queue,
  };
}

async function updateCommunityProfile(rawId, changes = {}) {
  const id = profileId(rawId);
  const displayName = changes.displayName === undefined ? undefined : String(changes.displayName || "").trim().slice(0, 100) || null;
  const notes = changes.notes === undefined ? undefined : String(changes.notes || "").trim().slice(0, 2000) || null;
  const aliases = changes.aliases === undefined ? undefined : cleanAliases(changes.aliases);
  let birthday;
  if (changes.day !== undefined || changes.month !== undefined || changes.year !== undefined) {
    if (changes.day === null || changes.day === "" || changes.month === null || changes.month === "") {
      birthday = { day: null, month: null, year: null };
    } else {
      const day = Number(changes.day), month = Number(changes.month);
      const year = changes.year ? Number(changes.year) : null;
      const date = new Date(Date.UTC(year || 2000, month - 1, day));
      if (!Number.isInteger(day) || !Number.isInteger(month)
        || date.getUTCDate() !== day || date.getUTCMonth() + 1 !== month
        || (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100))) {
        throw Object.assign(new Error("invalid_birthday"), { status: 400 });
      }
      birthday = { day, month, year };
    }
  }
  if (displayName === undefined && notes === undefined && birthday === undefined && aliases === undefined) return getCommunityProfile(id);
  const sets = [];
  const values = [id];
  if (displayName !== undefined) { values.push(displayName); sets.push(`display_name = $${values.length}`); }
  if (notes !== undefined) { values.push(notes); sets.push(`notes = $${values.length}`); }
  if (birthday !== undefined) {
    values.push(birthday.day, birthday.month, birthday.year);
    sets.push(`birth_day = $${values.length - 2}`, `birth_month = $${values.length - 1}`, `birth_year = $${values.length}`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let exists;
    if (sets.length) {
      exists = await client.query(`UPDATE community_profiles SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING id`, values);
    } else {
      exists = await client.query("SELECT id FROM community_profiles WHERE id = $1 FOR UPDATE", [id]);
    }
    if (!exists.rows.length) { await client.query("ROLLBACK"); return null; }
    if (aliases !== undefined) {
      await client.query("DELETE FROM community_profile_aliases WHERE profile_id = $1", [id]);
      for (const alias of aliases) {
        await client.query("INSERT INTO community_profile_aliases (profile_id, alias) VALUES ($1, $2)", [id, alias]);
      }
    }
    await client.query("COMMIT");
    return getCommunityProfile(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function addCommunityIdentity(rawProfileId, data = {}) {
  const targetId = profileId(rawProfileId);
  const platform = String(data.platform || "").trim().toLowerCase();
  const userId = String(data.userId || "").trim().replace(/^@+/, "").toLowerCase();
  const displayName = String(data.displayName || data.userId || "").trim().replace(/^@+/, "").slice(0, 100);
  const communityId = String(data.communityId || "").trim();
  if (!IDENTITY_PLATFORMS.has(platform) || platform === "unknown" || !userId || userId.length > 100 || !displayName) {
    throw Object.assign(new Error("invalid_community_identity"), { status: 400 });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query("SELECT id FROM community_profiles WHERE id = $1 FOR UPDATE", [targetId]);
    if (!target.rows.length) throw Object.assign(new Error("community_profile_not_found"), { status: 404 });
    const existing = await client.query(
      `SELECT profile_id AS "profileId" FROM community_identities
       WHERE platform = $1 AND community_id = $2 AND platform_user_id = $3 FOR UPDATE`,
      [platform, communityId, userId]
    );
    const sourceId = existing.rows[0]?.profileId;
    if (sourceId && String(sourceId) !== String(targetId)) {
      await client.query(
        `UPDATE community_profiles target SET
           birth_day = COALESCE(target.birth_day, source.birth_day),
           birth_month = COALESCE(target.birth_month, source.birth_month),
           birth_year = COALESCE(target.birth_year, source.birth_year), updated_at = NOW()
         FROM community_profiles source WHERE target.id = $1 AND source.id = $2`,
        [targetId, sourceId]
      );
      await moveProfileAliases(client, targetId, sourceId);
      for (const table of ["community_identities", "giveaway_participants", "song_requests", "queue_items"]) {
        await client.query(`UPDATE ${table} SET profile_id = $1 WHERE profile_id = $2`, [targetId, sourceId]);
      }
      await client.query("DELETE FROM community_profiles WHERE id = $1", [sourceId]);
    }
    await client.query(
      `INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE
         SET profile_id = EXCLUDED.profile_id, display_name = EXCLUDED.display_name, updated_at = NOW()`,
      [targetId, platform, communityId, userId, displayName]
    );
    await client.query("COMMIT");
    return getCommunityProfile(targetId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function updateCommunityIdentity(rawProfileId, original = {}, changes = {}) {
  const targetId = profileId(rawProfileId);
  const oldPlatform = String(original.platform || "").trim().toLowerCase();
  const oldUserId = String(original.userId || "").trim().replace(/^@+/, "").toLowerCase();
  const oldCommunityId = String(original.communityId || "").trim();
  const platform = String(changes.platform || "").trim().toLowerCase();
  const userId = String(changes.userId || "").trim().replace(/^@+/, "").toLowerCase();
  const displayName = String(changes.displayName || changes.userId || "").trim().replace(/^@+/, "").slice(0, 100);
  const communityId = String(changes.communityId || "").trim();
  if (!IDENTITY_PLATFORMS.has(oldPlatform) || !oldUserId || !IDENTITY_PLATFORMS.has(platform)
    || platform === "unknown" || !userId || userId.length > 100 || !displayName) {
    throw Object.assign(new Error("invalid_community_identity"), { status: 400 });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT 1 FROM community_identities WHERE profile_id = $1 AND platform = $2
       AND community_id = $3 AND platform_user_id = $4 FOR UPDATE`,
      [targetId, oldPlatform, oldCommunityId, oldUserId]
    );
    if (!current.rows.length) throw Object.assign(new Error("community_identity_not_found"), { status: 404 });
    const conflict = await client.query(
      `SELECT profile_id AS "profileId" FROM community_identities
       WHERE platform = $1 AND community_id = $2 AND platform_user_id = $3 FOR UPDATE`,
      [platform, communityId, userId]
    );
    const sourceId = conflict.rows[0]?.profileId;
    if (sourceId && String(sourceId) !== String(targetId)) {
      await client.query(
        `UPDATE community_profiles target SET
           birth_day = COALESCE(target.birth_day, source.birth_day),
           birth_month = COALESCE(target.birth_month, source.birth_month),
           birth_year = COALESCE(target.birth_year, source.birth_year), updated_at = NOW()
         FROM community_profiles source WHERE target.id = $1 AND source.id = $2`,
        [targetId, sourceId]
      );
      await client.query(
        `DELETE FROM community_identities source USING community_identities target
         WHERE source.profile_id = $2 AND target.profile_id = $1
           AND source.platform = target.platform AND source.community_id = target.community_id
           AND source.platform_user_id = target.platform_user_id`,
        [targetId, sourceId]
      );
      await moveProfileAliases(client, targetId, sourceId);
      for (const table of ["community_identities", "giveaway_participants", "song_requests", "queue_items"]) {
        await client.query(`UPDATE ${table} SET profile_id = $1 WHERE profile_id = $2`, [targetId, sourceId]);
      }
      await client.query("DELETE FROM community_profiles WHERE id = $1", [sourceId]);
    }
    await client.query(
      `DELETE FROM community_identities WHERE profile_id = $1 AND platform = $2
       AND community_id = $3 AND platform_user_id = $4`,
      [targetId, oldPlatform, oldCommunityId, oldUserId]
    );
    await client.query(
      `INSERT INTO community_identities (profile_id, platform, community_id, platform_user_id, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (platform, community_id, platform_user_id) DO UPDATE
         SET profile_id = EXCLUDED.profile_id, display_name = EXCLUDED.display_name, updated_at = NOW()`,
      [targetId, platform, communityId, userId, displayName]
    );
    await client.query("COMMIT");
    return getCommunityProfile(targetId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function deleteCommunityIdentity(rawProfileId, identity = {}) {
  const id = profileId(rawProfileId);
  const platform = String(identity.platform || "").trim().toLowerCase();
  const userId = String(identity.userId || "").trim().replace(/^@+/, "").toLowerCase();
  const communityId = String(identity.communityId || "").trim();
  if (!IDENTITY_PLATFORMS.has(platform) || !userId) {
    throw Object.assign(new Error("invalid_community_identity"), { status: 400 });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query("SELECT id FROM community_profiles WHERE id = $1 FOR UPDATE", [id]);
    if (!owner.rows.length) throw Object.assign(new Error("community_profile_not_found"), { status: 404 });
    const count = await client.query("SELECT COUNT(*)::int AS count FROM community_identities WHERE profile_id = $1", [id]);
    if (!count.rows[0] || count.rows[0].count <= 1) {
      throw Object.assign(new Error("last_community_identity"), { status: 400 });
    }
    const removed = await client.query(
      `DELETE FROM community_identities WHERE profile_id = $1 AND platform = $2
       AND community_id = $3 AND platform_user_id = $4 RETURNING profile_id`,
      [id, platform, communityId, userId]
    );
    if (!removed.rows.length) throw Object.assign(new Error("community_identity_not_found"), { status: 404 });
    await client.query("COMMIT");
    return getCommunityProfile(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function mergeCommunityProfiles(rawTargetId, rawSourceId) {
  const targetId = profileId(rawTargetId);
  const sourceId = profileId(rawSourceId);
  if (targetId === sourceId) throw Object.assign(new Error("same_community_profile"), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      "SELECT id FROM community_profiles WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
      [[targetId, sourceId]]
    );
    if (locked.rows.length !== 2) throw Object.assign(new Error("community_profile_not_found"), { status: 404 });
    await client.query(
      `UPDATE community_profiles target SET
         display_name = COALESCE(target.display_name, source.display_name),
         notes = COALESCE(target.notes, source.notes),
         birth_day = COALESCE(target.birth_day, source.birth_day),
         birth_month = COALESCE(target.birth_month, source.birth_month),
         birth_year = COALESCE(target.birth_year, source.birth_year), updated_at = NOW()
       FROM community_profiles source WHERE target.id = $1 AND source.id = $2`,
      [targetId, sourceId]
    );
    // Una fusión entre dos perfiles con Twitch representa normalmente un cambio
    // de nombre: se conserva el Twitch de la ficha principal y se descarta el anterior.
    await client.query(
      `DELETE FROM community_identities source WHERE source.profile_id = $2 AND source.platform = 'twitch'
       AND EXISTS (SELECT 1 FROM community_identities target
                   WHERE target.profile_id = $1 AND target.platform = 'twitch')`,
      [targetId, sourceId]
    );
    await client.query(
      `DELETE FROM community_identities source USING community_identities target
       WHERE source.profile_id = $2 AND target.profile_id = $1
         AND source.platform = target.platform AND source.community_id = target.community_id
         AND source.platform_user_id = target.platform_user_id`,
      [targetId, sourceId]
    );
    await moveProfileAliases(client, targetId, sourceId);
    for (const table of ["community_identities", "giveaway_participants", "song_requests", "queue_items"]) {
      await client.query(`UPDATE ${table} SET profile_id = $1 WHERE profile_id = $2`, [targetId, sourceId]);
    }
    await client.query("DELETE FROM community_profiles WHERE id = $1", [sourceId]);
    await client.query("COMMIT");
    return getCommunityProfile(targetId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

module.exports = { findOrCreateCommunityProfile, createCommunityProfile, searchCommunityProfiles, listRecentCommunityActivity, listBirthdaysForDate, getCommunityProfile, updateCommunityProfile, addCommunityIdentity, updateCommunityIdentity, deleteCommunityIdentity, mergeCommunityProfiles };
