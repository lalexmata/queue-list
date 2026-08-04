const { pool } = require("../database/db");

function cleanMessage(value) {
  const content = String(value || "").trim();
  if (!content || content.length > 2000) throw Object.assign(new Error("invalid_pixelbot_message"), { status: 400 });
  return content;
}

async function scheduleMessage({ guildId, channelId, content, sendAt }) {
  const date = new Date(sendAt);
  if (!guildId || !channelId || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw Object.assign(new Error("invalid_pixelbot_schedule"), { status: 400 });
  }
  const { rows } = await pool.query(
    `INSERT INTO pixelbot_scheduled_messages (guild_id, channel_id, content, send_at)
     VALUES ($1, $2, $3, $4) RETURNING id, guild_id AS "guildId", channel_id AS "channelId",
       content, send_at AS "sendAt", status, created_at AS "createdAt"`,
    [String(guildId), String(channelId), cleanMessage(content), date]
  );
  return rows[0];
}

async function listScheduledMessages() {
  const { rows } = await pool.query(
    `SELECT id, guild_id AS "guildId", channel_id AS "channelId", content,
            send_at AS "sendAt", status, error_message AS "errorMessage", sent_at AS "sentAt"
     FROM pixelbot_scheduled_messages WHERE status IN ('pending', 'processing', 'failed')
     ORDER BY send_at ASC LIMIT 100`
  );
  return rows;
}

async function cancelScheduledMessage(id) {
  const { rows } = await pool.query(
    `UPDATE pixelbot_scheduled_messages SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status = 'pending' RETURNING id`, [Number(id)]
  );
  return Boolean(rows[0]);
}

async function claimDueMessages() {
  const { rows } = await pool.query(
    `WITH due AS (
       SELECT id FROM pixelbot_scheduled_messages
       WHERE status = 'pending' AND send_at <= NOW() ORDER BY send_at LIMIT 20 FOR UPDATE SKIP LOCKED
     ) UPDATE pixelbot_scheduled_messages m SET status = 'processing', updated_at = NOW()
       FROM due WHERE m.id = due.id
       RETURNING m.id, m.guild_id AS "guildId", m.channel_id AS "channelId", m.content`
  );
  return rows;
}

async function finishScheduledMessage(id, error = null) {
  await pool.query(
    `UPDATE pixelbot_scheduled_messages SET status = $2, error_message = $3,
       sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END, updated_at = NOW() WHERE id = $1`,
    [id, error ? "failed" : "sent", error ? String(error.message || error).slice(0, 1000) : null]
  );
}

module.exports = { cleanMessage, scheduleMessage, listScheduledMessages, cancelScheduledMessage, claimDueMessages, finishScheduledMessage };
