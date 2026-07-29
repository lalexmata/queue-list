const { pool } = require("../database/db");

const PARTICIPANT_COLUMNS = `
  id,
  username,
  display_name AS "displayName",
  platform,
  coupon_count AS "couponCount",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

function cleanUsername(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function cleanDisplayName(value, fallback) {
  return String(value || fallback || "").trim().slice(0, 100);
}

function cleanPlatform(value) {
  const platform = String(value || "twitch").trim().toLowerCase();
  const supported = ["twitch", "tiktok", "youtube", "kick", "facebook", "instagram", "discord", "other"];
  if (!supported.includes(platform)) {
    throw Object.assign(new Error("invalid_platform"), { status: 400 });
  }
  return platform;
}

function validateCouponCount(value, { allowZero = false } = {}) {
  const count = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(count) || count < minimum || count > 1000000) {
    throw Object.assign(new Error("invalid_coupon_count"), { status: 400 });
  }
  return count;
}

async function listParticipants() {
  const { rows } = await pool.query(
    `SELECT ${PARTICIPANT_COLUMNS}
     FROM giveaway_participants
     ORDER BY coupon_count DESC, LOWER(platform) ASC, LOWER(display_name) ASC, id ASC`
  );
  return rows;
}

function normalizeParticipant({ username: rawUsername, displayName, platform = "twitch", couponCount = 1 }) {
  const username = cleanUsername(rawUsername);
  if (!username || username.length > 100 || !/^[a-z0-9_]+$/i.test(username)) {
    throw Object.assign(new Error("invalid_username"), { status: 400 });
  }

  return {
    username,
    displayName: cleanDisplayName(displayName, username),
    platform: cleanPlatform(platform),
    couponCount: validateCouponCount(couponCount),
  };
}

async function upsertCoupons(db, participant) {
  const { username, displayName, platform, couponCount } = normalizeParticipant(participant);
  const { rows } = await db.query(
    `INSERT INTO giveaway_participants
       (username, display_name, platform, coupon_count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (LOWER(platform), LOWER(username))
     DO UPDATE SET
       display_name = CASE
         WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name
         ELSE giveaway_participants.display_name
       END,
       coupon_count = giveaway_participants.coupon_count + EXCLUDED.coupon_count,
       updated_at = NOW()
     RETURNING ${PARTICIPANT_COLUMNS}`,
    [username, displayName, platform, couponCount]
  );
  return rows[0];
}

async function addCoupons(participant) {
  return upsertCoupons(pool, participant);
}

async function addBulkCoupons(participants) {
  if (!Array.isArray(participants) || !participants.length || participants.length > 5000) {
    throw Object.assign(new Error("invalid_participant_list"), { status: 400 });
  }

  // Validamos todo antes de escribir para evitar una importación parcial.
  const normalized = participants.map(normalizeParticipant);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const imported = [];
    for (const participant of normalized) {
      imported.push(await upsertCoupons(client, participant));
    }
    await client.query("COMMIT");
    return imported;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setCouponCount(id, couponCount) {
  const count = validateCouponCount(couponCount, { allowZero: true });
  const { rows } = await pool.query(
    `UPDATE giveaway_participants
     SET coupon_count = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING ${PARTICIPANT_COLUMNS}`,
    [id, count]
  );
  return rows[0] || null;
}

async function setDisplayName(id, displayName) {
  const name = cleanDisplayName(displayName);
  if (!name) {
    throw Object.assign(new Error("invalid_display_name"), { status: 400 });
  }
  const { rows } = await pool.query(
    `UPDATE giveaway_participants
     SET display_name = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING ${PARTICIPANT_COLUMNS}`,
    [id, name]
  );
  return rows[0] || null;
}

async function removeParticipant(id) {
  const { rows } = await pool.query(
    `DELETE FROM giveaway_participants WHERE id = $1
     RETURNING ${PARTICIPANT_COLUMNS}`,
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  addCoupons,
  addBulkCoupons,
  listParticipants,
  removeParticipant,
  setCouponCount,
  setDisplayName,
};
