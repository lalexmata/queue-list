const { pool } = require("../database/db");
const { findOrCreateCommunityProfile } = require("./community-profile.service");

const SOURCES = ["channel_points", "subscriber", "gifted_subs", "bits", "purchase"];
const PARTICIPANT_COLUMNS = `
  p.id, p.profile_id AS "profileId", p.giveaway_id AS "giveawayId", p.username, p.display_name AS "displayName", p.platform,
  COALESCE(SUM(s.coupon_count), 0)::int AS "couponCount",
  COALESCE(MAX(s.coupon_count) FILTER (WHERE s.source = 'channel_points'), 0)::int AS "channelPointsCount",
  COALESCE(MAX(s.coupon_count) FILTER (WHERE s.source = 'subscriber'), 0)::int AS "subscriberCount",
  COALESCE(MAX(s.coupon_count) FILTER (WHERE s.source = 'gifted_subs'), 0)::int AS "giftedSubsCount",
  COALESCE(MAX(s.coupon_count) FILTER (WHERE s.source = 'bits'), 0)::int AS "bitsCount",
  COALESCE(MAX(s.coupon_count) FILTER (WHERE s.source = 'purchase'), 0)::int AS "purchaseCount",
  p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;

function fail(code, status = 400, details = {}) {
  return Object.assign(new Error(code), { status }, details);
}

function cleanSource(value) {
  const aliases = {
    points: "channel_points", channel: "channel_points", sub: "subscriber",
    subscription: "subscriber", gifted: "gifted_subs", gifted_subscriptions: "gifted_subs",
    bit: "bits", cheers: "bits", cheer: "bits",
    compra: "purchase", purchases: "purchase",
  };
  const raw = String(value || "").trim().toLowerCase();
  const source = aliases[raw] || raw;
  if (!SOURCES.includes(source)) throw fail("invalid_coupon_source");
  return source;
}

function validateCouponCount(value, { allowZero = false } = {}) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < (allowZero ? 0 : 1) || count > 1000000) {
    throw fail("invalid_coupon_count");
  }
  return count;
}

function normalizeParticipant(data) {
  const username = String(data.username || "").trim().replace(/^@+/, "").toLowerCase();
  if (!username || username.length > 100 || !/^[a-z0-9_]+$/i.test(username)) throw fail("invalid_username");
  const platform = String(data.platform || "twitch").trim().toLowerCase();
  if (!["twitch", "tiktok", "youtube", "kick", "facebook", "instagram", "discord", "other"].includes(platform)) {
    throw fail("invalid_platform");
  }
  return {
    username,
    displayName: String(data.displayName || username).trim().slice(0, 100),
    platform,
    couponCount: validateCouponCount(data.couponCount ?? 1),
    source: cleanSource(data.source),
  };
}

async function getParticipant(db, id) {
  const { rows } = await db.query(
    `SELECT ${PARTICIPANT_COLUMNS}
     FROM giveaway_participants p LEFT JOIN giveaway_coupon_sources s ON s.participant_id = p.id
     WHERE p.id = $1 GROUP BY p.id`,
    [id]
  );
  return rows[0] || null;
}

async function getActiveGiveawayId(db = pool) {
  const { rows } = await db.query(`SELECT id FROM giveaways WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
  if (!rows[0]) throw fail("no_active_giveaway", 409);
  return rows[0].id;
}

async function getActiveGiveaway(db = pool) {
  const { rows } = await db.query(
    `SELECT id, name, draw_at AS "drawAt", winner_count AS "winnerCount", status
     FROM giveaways WHERE status = 'active' ORDER BY id DESC LIMIT 1`
  );
  return rows[0] || null;
}

function giveawayDateMessage(drawAt) {
  if (!drawAt) return "su fecha aún está por confirmar";
  const date = new Date(drawAt);
  if (Number.isNaN(date.getTime())) return "su fecha aún está por confirmar";
  const formatted = new Intl.DateTimeFormat("es-CL", {
    day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago",
  }).format(date);
  return `se realizará el ${formatted}`;
}

async function getOrCreateStreamerGiveaway(db) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('giveaway_stream_events'))");
  const { rows } = await db.query(
    `SELECT id, status FROM giveaways
     WHERE status IN ('active', 'draft')
     ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC, id DESC
     LIMIT 1`
  );
  if (rows[0]) return rows[0];
  const created = await db.query(
    `INSERT INTO giveaways (name, winner_count, status)
     VALUES ('Próximo sorteo', 1, 'draft') RETURNING id, status`
  );
  return created.rows[0];
}

async function listParticipants(giveawayId = null) {
  const selectedGiveawayId = giveawayId || await getActiveGiveawayId();
  const { rows } = await pool.query(
    `SELECT ${PARTICIPANT_COLUMNS}
     FROM giveaway_participants p LEFT JOIN giveaway_coupon_sources s ON s.participant_id = p.id
     WHERE p.giveaway_id = $1
     GROUP BY p.id
     ORDER BY COALESCE(SUM(s.coupon_count), 0) DESC, LOWER(p.platform), LOWER(p.display_name), p.id`,
    [selectedGiveawayId]
  );
  return rows;
}

async function listBitBalances(giveawayId = null) {
  const selectedGiveawayId = giveawayId || await getActiveGiveawayId();
  const { rows } = await pool.query(
    `SELECT b.username, b.platform, COALESCE(p.display_name, b.username) AS "displayName",
            b.total_bits::int AS "totalBits",
            FLOOR(b.total_bits / 100.0)::int AS "earnedCoupons",
            MOD(b.total_bits, 100)::int AS "remainingBits",
            b.updated_at AS "updatedAt"
     FROM giveaway_stream_bit_balances b
     LEFT JOIN giveaway_participants p ON p.giveaway_id = b.giveaway_id
       AND LOWER(p.platform) = LOWER(b.platform) AND LOWER(p.username) = LOWER(b.username)
     WHERE b.giveaway_id = $1
     ORDER BY b.total_bits DESC, LOWER(b.username)`,
    [selectedGiveawayId]
  );
  return rows;
}

async function findParticipantByUsername(rawUsername, rawPlatform = "twitch") {
  const username = String(rawUsername || "").trim().replace(/^@+/, "").toLowerCase();
  if (!username || username.length > 100 || !/^[a-z0-9_]+$/i.test(username)) throw fail("invalid_username");
  const platform = String(rawPlatform || "twitch").trim().toLowerCase();
  if (!["twitch", "tiktok", "youtube", "kick", "facebook", "instagram", "discord", "other"].includes(platform)) {
    throw fail("invalid_platform");
  }
  const giveawayId = await getActiveGiveawayId();
  const { rows } = await pool.query(
    `SELECT ${PARTICIPANT_COLUMNS}
     FROM giveaway_participants p LEFT JOIN giveaway_coupon_sources s ON s.participant_id = p.id
     WHERE LOWER(p.username) = $1 AND LOWER(p.platform) = $2 AND p.giveaway_id = $3
     GROUP BY p.id`,
    [username, platform, giveawayId]
  );
  return rows[0] || null;
}

async function getSettings(db = pool) {
  const { rows } = await db.query(
    `SELECT channel_points_limit AS "channelPointsLimit", is_active AS "isActive"
     FROM giveaway_settings WHERE id = 1`
  );
  return rows[0] || { channelPointsLimit: null, isActive: false };
}

async function setGiveawayActive(isActive) {
  const { rows } = await pool.query(
    `INSERT INTO giveaway_settings (id, is_active) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, updated_at = NOW()
     RETURNING channel_points_limit AS "channelPointsLimit", is_active AS "isActive"`,
    [Boolean(isActive)]
  );
  return rows[0];
}

async function upsertCoupons(db, rawParticipant, selectedGiveawayId = null) {
  const item = normalizeParticipant(rawParticipant);
  const giveawayId = selectedGiveawayId || await getActiveGiveawayId(db);
  const profileId = await findOrCreateCommunityProfile(db, {
    platform: item.platform, userId: item.username, displayName: item.displayName,
  });
  const { rows } = await db.query(
    `INSERT INTO giveaway_participants (giveaway_id, profile_id, username, display_name, platform, coupon_count)
     VALUES ($1, $2, $3, $4, $5, 0)
     ON CONFLICT (giveaway_id, LOWER(platform), LOWER(username)) DO UPDATE SET
       profile_id = EXCLUDED.profile_id, display_name = EXCLUDED.display_name, updated_at = NOW()
     RETURNING id`,
    [giveawayId, profileId, item.username, item.displayName, item.platform]
  );
  const participantId = rows[0].id;
  if (item.source === "subscriber") {
    if (item.couponCount > 3) throw fail("subscriber_coupon_limit");
    await db.query(
      `INSERT INTO giveaway_coupon_sources (participant_id, source, coupon_count)
       VALUES ($1::bigint, $2::text, $3::integer)
       ON CONFLICT (participant_id, source) DO UPDATE SET
         coupon_count = GREATEST(giveaway_coupon_sources.coupon_count, EXCLUDED.coupon_count),
         updated_at = NOW()`,
      [participantId, item.source, item.couponCount]
    );
  } else if (item.source === "channel_points") {
    const { channelPointsLimit } = await getSettings(db);
    const { rows: sourceRows } = await db.query(
      `SELECT coupon_count AS "couponCount"
       FROM giveaway_coupon_sources
       WHERE participant_id = $1 AND source = 'channel_points'
       FOR UPDATE`,
      [participantId]
    );
    const currentCount = Number(sourceRows[0]?.couponCount || 0);
    if (channelPointsLimit !== null && currentCount + item.couponCount > channelPointsLimit) {
      throw fail("channel_points_limit_reached", 409, {
        refund: true,
        couponCount: currentCount,
        limit: channelPointsLimit,
        chatMessage: `@${item.username} no puedes canjear más cupones con puntos de canal. Ya alcanzaste el límite de ${channelPointsLimit}. Puntos devueltos`,
      });
    }
    await db.query(
      `INSERT INTO giveaway_coupon_sources (participant_id, source, coupon_count)
       VALUES (
         $1::bigint,
         $2::text,
         LEAST($3::integer, COALESCE($4::integer, $3::integer))
       )
       ON CONFLICT (participant_id, source) DO UPDATE SET
         coupon_count = LEAST(giveaway_coupon_sources.coupon_count + EXCLUDED.coupon_count,
           COALESCE($4::integer, giveaway_coupon_sources.coupon_count + EXCLUDED.coupon_count)),
         updated_at = NOW()`,
      [participantId, item.source, item.couponCount, channelPointsLimit]
    );
  } else {
    await db.query(
      `INSERT INTO giveaway_coupon_sources (participant_id, source, coupon_count)
       VALUES ($1::bigint, $2::text, $3::integer)
       ON CONFLICT (participant_id, source) DO UPDATE SET
         coupon_count = giveaway_coupon_sources.coupon_count + EXCLUDED.coupon_count, updated_at = NOW()`,
      [participantId, item.source, item.couponCount]
    );
  }
  return getParticipant(db, participantId);
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function addCoupons(participant) {
  return inTransaction(client => upsertCoupons(client, participant));
}

async function addCouponsForEvent(participant, event = {}) {
  const eventId = String(event.eventId || "").trim().slice(0, 200);
  const eventType = String(event.eventType || "").trim();
  const amount = validateCouponCount(event.amount);
  return inTransaction(async client => {
    const normalized = normalizeParticipant({
      ...participant,
      couponCount: eventType === "bits" ? 1 : participant.couponCount,
    });
    if (eventId) {
      const { rows: existing } = await client.query(
        `SELECT participant_id AS "participantId" FROM giveaway_stream_events
         WHERE event_type = $1 AND event_id = $2`,
        [eventType, eventId]
      );
      if (existing[0]) {
        return {
          participant: existing[0].participantId ? await getParticipant(client, existing[0].participantId) : null,
          duplicate: true,
        };
      }
    }
    const giveaway = await getOrCreateStreamerGiveaway(client);
    let streamEventId = null;
    if (eventId) {
      const { rows } = await client.query(
        `INSERT INTO giveaway_stream_events (giveaway_id, event_id, event_type, username, amount)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_type, event_id) DO NOTHING
         RETURNING id`,
        [giveaway.id, eventId, eventType, normalized.username, amount]
      );
      if (!rows[0]) {
        const { rows: existing } = await client.query(
          `SELECT participant_id AS "participantId" FROM giveaway_stream_events
           WHERE event_type = $1 AND event_id = $2`,
          [eventType, eventId]
        );
        return {
          participant: existing[0]?.participantId ? await getParticipant(client, existing[0].participantId) : null,
          duplicate: true,
        };
      }
      streamEventId = rows[0].id;
    }

    let couponCountAdded = normalized.couponCount;
    let totalBits = null;
    let remainingBits = null;
    if (eventType === "bits") {
      const { rows: balances } = await client.query(
        `SELECT total_bits AS "totalBits" FROM giveaway_stream_bit_balances
         WHERE giveaway_id = $1 AND platform = $2 AND username = $3 FOR UPDATE`,
        [giveaway.id, normalized.platform, normalized.username]
      );
      const previousTotal = Number(balances[0]?.totalBits || 0);
      totalBits = previousTotal + amount;
      couponCountAdded = Math.floor(totalBits / 100) - Math.floor(previousTotal / 100);
      remainingBits = totalBits % 100;
      await client.query(
        `INSERT INTO giveaway_stream_bit_balances (giveaway_id, platform, username, total_bits)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (giveaway_id, platform, username) DO UPDATE
         SET total_bits = EXCLUDED.total_bits, updated_at = NOW()`,
        [giveaway.id, normalized.platform, normalized.username, totalBits]
      );
    }

    const savedParticipant = couponCountAdded > 0
      ? await upsertCoupons(client, { ...normalized, couponCount: couponCountAdded }, giveaway.id)
      : null;
    if (streamEventId && savedParticipant) {
      await client.query("UPDATE giveaway_stream_events SET participant_id = $2 WHERE id = $1", [streamEventId, savedParticipant.id]);
    }
    return {
      participant: savedParticipant, duplicate: false, giveawayStatus: giveaway.status,
      couponCountAdded, totalBits, remainingBits,
    };
  });
}

async function addBulkCoupons(participants) {
  if (!Array.isArray(participants) || !participants.length || participants.length > 5000) {
    throw fail("invalid_participant_list");
  }
  const normalized = participants.map(normalizeParticipant);
  return inTransaction(async client => {
    const imported = [];
    for (const item of normalized) imported.push(await upsertCoupons(client, item));
    return imported;
  });
}

async function setSourceCount(id, source, couponCount) {
  const clean = cleanSource(source);
  const count = validateCouponCount(couponCount, { allowZero: true });
  if (clean === "subscriber" && count > 3) throw fail("subscriber_coupon_limit");
  if (clean === "channel_points") {
    const { channelPointsLimit } = await getSettings();
    if (channelPointsLimit !== null && count > channelPointsLimit) throw fail("channel_points_limit_reached");
  }
  if (!await getParticipant(pool, id)) return null;
  await pool.query(
    `INSERT INTO giveaway_coupon_sources (participant_id, source, coupon_count)
     VALUES ($1::bigint, $2::text, $3::integer)
     ON CONFLICT (participant_id, source) DO UPDATE SET coupon_count = EXCLUDED.coupon_count, updated_at = NOW()`,
    [id, clean, count]
  );
  return getParticipant(pool, id);
}

async function setSourceCounts(id, counts) {
  const normalized = {};
  for (const source of SOURCES) {
    normalized[source] = validateCouponCount(counts?.[source], { allowZero: true });
  }
  if (normalized.subscriber > 3) throw fail("subscriber_coupon_limit");
  const { channelPointsLimit } = await getSettings();
  if (channelPointsLimit !== null && normalized.channel_points > channelPointsLimit) {
    throw fail("channel_points_limit_reached");
  }
  return inTransaction(async client => {
    if (!await getParticipant(client, id)) return null;
    for (const source of SOURCES) {
      await client.query(
        `INSERT INTO giveaway_coupon_sources (participant_id, source, coupon_count)
         VALUES ($1::bigint, $2::text, $3::integer)
         ON CONFLICT (participant_id, source) DO UPDATE
         SET coupon_count = EXCLUDED.coupon_count, updated_at = NOW()`,
        [id, source, normalized[source]]
      );
    }
    return getParticipant(client, id);
  });
}

async function setDisplayName(id, displayName) {
  const name = String(displayName || "").trim().slice(0, 100);
  if (!name) throw fail("invalid_display_name");
  const { rows } = await pool.query(
    `UPDATE giveaway_participants SET display_name = $2, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [id, name]
  );
  return rows[0] ? getParticipant(pool, id) : null;
}

async function removeParticipant(id) {
  const participant = await getParticipant(pool, id);
  if (!participant) return null;
  await pool.query("DELETE FROM giveaway_participants WHERE id = $1", [id]);
  return participant;
}

async function updateSettings(value) {
  const limit = value === null || value === "" ? null : validateCouponCount(value);
  return inTransaction(async client => {
    const { rows } = await client.query(
      `INSERT INTO giveaway_settings (id, channel_points_limit) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET channel_points_limit = EXCLUDED.channel_points_limit, updated_at = NOW()
       RETURNING channel_points_limit AS "channelPointsLimit"`,
      [limit]
    );
    if (limit !== null) {
      await client.query(
        `UPDATE giveaway_coupon_sources
         SET coupon_count = LEAST(coupon_count, $1::integer), updated_at = NOW()
         WHERE source = 'channel_points' AND coupon_count > $1::integer`,
        [limit]
      );
    }
    return rows[0];
  });
}

module.exports = {
  addCoupons, addCouponsForEvent, addBulkCoupons, findParticipantByUsername, getSettings, listParticipants, listBitBalances, removeParticipant,
  setDisplayName, setSourceCount, setSourceCounts, updateSettings, setGiveawayActive,
  getActiveGiveawayId, getActiveGiveaway, giveawayDateMessage,
};
