const { pool } = require("../database/db");

function fail(code, status = 400) {
  return Object.assign(new Error(code), { status });
}

function normalizeInput(data) {
  const name = String(data?.name || "").trim().slice(0, 120);
  if (!name) throw fail("invalid_giveaway_name");
  const winnerCount = Number(data?.winnerCount ?? 1);
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 100) throw fail("invalid_winner_count");
  let drawAt = null;
  if (data?.drawAt) {
    const date = new Date(data.drawAt);
    if (Number.isNaN(date.getTime())) throw fail("invalid_draw_date");
    drawAt = date.toISOString();
  }
  return { name, winnerCount, drawAt };
}

async function listGiveaways() {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.draw_at AS "drawAt", g.winner_count AS "winnerCount", g.status,
            g.created_at AS "createdAt", g.activated_at AS "activatedAt", g.finished_at AS "finishedAt",
            COUNT(DISTINCT p.id)::int AS "participantCount",
            COALESCE(SUM(s.coupon_count), 0)::int AS "couponCount",
            COALESCE(JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
              'id', w.id, 'position', w.position, 'participantId', p.id,
              'username', p.username, 'displayName', p.display_name, 'platform', p.platform,
              'notes', w.notes
            )) FILTER (WHERE w.id IS NOT NULL), '[]') AS winners
     FROM giveaways g
     LEFT JOIN giveaway_participants p ON p.giveaway_id = g.id
     LEFT JOIN giveaway_coupon_sources s ON s.participant_id = p.id
     LEFT JOIN giveaway_winners w ON w.giveaway_id = g.id AND w.participant_id = p.id
     GROUP BY g.id
     ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, COALESCE(g.draw_at, g.created_at) DESC, g.id DESC`
  );
  for (const row of rows) row.winners.sort((a, b) => a.position - b.position);
  return rows;
}

async function getGiveaway(id) {
  const items = await listGiveaways();
  return items.find(item => String(item.id) === String(id)) || null;
}

async function getLatestGiveawayWithWinners() {
  const items = await listGiveaways();
  return items.find(item => item.status === "finished" && item.winners.length)
    || items.find(item => item.winners.length)
    || null;
}

async function createGiveaway(data) {
  const item = normalizeInput(data);
  const { rows } = await pool.query(
    `INSERT INTO giveaways (name, draw_at, winner_count, status)
     VALUES ($1, $2, $3, 'draft')
     RETURNING id`, [item.name, item.drawAt, item.winnerCount]
  );
  return getGiveaway(rows[0].id);
}

async function updateGiveaway(id, data) {
  const item = normalizeInput(data);
  const { rows } = await pool.query(
    `UPDATE giveaways SET name = $2, draw_at = $3, winner_count = $4, updated_at = NOW()
     WHERE id = $1 AND status <> 'finished' RETURNING id`,
    [id, item.name, item.drawAt, item.winnerCount]
  );
  if (!rows[0]) throw fail("giveaway_not_editable", 409);
  return getGiveaway(id);
}

async function activateGiveaway(id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const active = await client.query(`SELECT id FROM giveaways WHERE status = 'active' AND id <> $1 FOR UPDATE`, [id]);
    if (active.rows[0]) throw fail("active_giveaway_exists", 409);
    const { rows } = await client.query(
      `UPDATE giveaways SET status = 'active', activated_at = COALESCE(activated_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND status = 'draft' RETURNING id`, [id]
    );
    if (!rows[0]) throw fail("giveaway_not_draft", 409);
    await client.query("COMMIT");
    return getGiveaway(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finishGiveaway(id) {
  const { rows } = await pool.query(
    `UPDATE giveaways SET status = 'finished', finished_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'active' RETURNING id`, [id]
  );
  if (!rows[0]) throw fail("giveaway_not_active", 409);
  return getGiveaway(id);
}

async function setWinner(giveawayId, participantId, position, notes = null) {
  const rank = Number(position);
  if (!Number.isInteger(rank) || rank < 1 || rank > 100) throw fail("invalid_winner_position");
  const { rows: giveawayRows } = await pool.query(`SELECT winner_count FROM giveaways WHERE id = $1`, [giveawayId]);
  if (!giveawayRows[0]) throw fail("giveaway_not_found", 404);
  if (rank > Number(giveawayRows[0].winner_count)) throw fail("winner_position_exceeds_limit");
  const { rows } = await pool.query(
    `INSERT INTO giveaway_winners (giveaway_id, participant_id, position, notes)
     SELECT $1, p.id, $3, $4 FROM giveaway_participants p
     WHERE p.id = $2 AND p.giveaway_id = $1
     ON CONFLICT (giveaway_id, position) DO UPDATE
       SET participant_id = EXCLUDED.participant_id, notes = EXCLUDED.notes, selected_at = NOW()
     RETURNING id`, [giveawayId, participantId, rank, String(notes || "").trim().slice(0, 250) || null]
  );
  if (!rows[0]) throw fail("participant_not_found", 404);
  return getGiveaway(giveawayId);
}

async function removeWinner(giveawayId, winnerId) {
  const { rowCount } = await pool.query(`DELETE FROM giveaway_winners WHERE id = $1 AND giveaway_id = $2`, [winnerId, giveawayId]);
  if (!rowCount) throw fail("winner_not_found", 404);
  return getGiveaway(giveawayId);
}

module.exports = { listGiveaways, getGiveaway, getLatestGiveawayWithWinners, createGiveaway, updateGiveaway, activateGiveaway, finishGiveaway, setWinner, removeWinner };
