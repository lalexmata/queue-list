const { pool } = require('../database/db');
const {normalizeRole, ROLE_BLOCK} = require('../helpers/helpers');

async function getQueue() {
  const { rows } = await pool.query(
    `SELECT unique_id AS "uniqueId",
            nickname,
            role,
            is_sub AS "isSub",
            platform,
            ts
     FROM queue_items
     ORDER BY position ASC, ts ASC`
  );
  return rows;
}

async function clearQueue() {
  await pool.query(`DELETE FROM queue_items`);
}

async function removeFromQueue(uniqueId) {
  const { rowCount } = await pool.query(
    `DELETE FROM queue_items WHERE lower(unique_id) = lower($1)`,
    [uniqueId]
  );
  return rowCount > 0;
}

async function upsertByPriority(user) {
  const role = normalizeRole(user.role);
  const base = ROLE_BLOCK[role];
  const upper = base + 1000;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serializa canjes simultáneos del mismo usuario, ignorando mayúsculas.
    await client.query("SELECT pg_advisory_xact_lock(hashtext(lower($1)))", [user.uniqueId]);
    const existing = await client.query(
      `SELECT unique_id, position
       FROM queue_items
       WHERE lower(unique_id) = lower($1)
       LIMIT 1
       FOR UPDATE`,
      [user.uniqueId]
    );

    if (existing.rows[0]) {
      await client.query(
        `UPDATE queue_items
         SET nickname = $2, role = $3, is_sub = $4, platform = $5
         WHERE unique_id = $1`,
        [
          existing.rows[0].unique_id,
          user.nickname,
          role,
          role === "subscriber",
          user.platform || "unknown",
        ]
      );
      await client.query("COMMIT");
      return { added: false, position: Number(existing.rows[0].position) };
    }

    const { rows } = await client.query(
      `SELECT COALESCE(MAX(position), $1) AS maxpos
       FROM queue_items
       WHERE position >= $1 AND position < $2`,
      [base, upper]
    );
    const nextPos = Number(rows[0].maxpos) + 1;
    await client.query(
      `INSERT INTO queue_items (unique_id, nickname, role, is_sub, platform, ts, position)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [user.uniqueId, user.nickname, role, role === "subscriber", user.platform || "unknown", nextPos]
    );
    await client.query("COMMIT");
    return { added: true, position: nextPos };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getQueueWithPosition() {
  const { rows } = await pool.query(
    `SELECT unique_id AS "uniqueId",
            nickname,
            role,
            is_sub AS "isSub",
            platform,
            ts,
            position
     FROM queue_items
     ORDER BY position ASC, ts ASC`
  );
  return rows;
}

/**
 * Reordena manteniendo regla SUB/no-SUB (y/o bloques por rol si usas position por block).
 * from/to son índices del listado actual (ordenado por position).
 */
async function reorderByIndex(from, to) {
  await pool.query("BEGIN");

  try {
    const q = await getQueueWithPosition();

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      throw Object.assign(new Error("from/to must be integers"), { status: 400 });
    }
    if (from < 0 || from >= q.length || to < 0 || to >= q.length) {
      throw Object.assign(new Error("index out of range"), { status: 400 });
    }
    if (from === to) {
      await pool.query("COMMIT");
      return { ok: true, size: q.length };
    }

    const moving = q[from];
    const movingRole = normalizeRole(moving.role);

    // ✅ Regla SUB/no-SUB (igual que tu admin)
    const subCount = q.filter(u => u.isSub === true).length;
    const movingIsSub = moving.isSub === true;

    const allowedMin = movingIsSub ? 0 : subCount;
    const allowedMax = movingIsSub ? Math.max(subCount - 1, 0) : q.length - 1;

    if (to < allowedMin || to > allowedMax) {
      throw Object.assign(new Error("sub_rule_violation"), { status: 409, code: "sub_rule_violation" });
    }

    // ✅ Mantener dentro del mismo bloque de rol
    // Solo permitimos mover un usuario si el destino tiene usuarios del mismo rol o superior
    const targetUser = q[to];
    const targetRole = normalizeRole(targetUser.role);
    
    // Obtener prioridad numérica del rol (menor = mayor prioridad)
    const rolePriority = {
      'broadcaster': 0,
      'moderator': 1,
      'vip': 2,
      'subscriber': 3,
      'viewer': 4
    };
    
    const movingPriority = rolePriority[movingRole] ?? 4;
    const targetPriority = rolePriority[targetRole] ?? 4;
    
    // Un usuario NO puede moverse encima de alguien con mayor prioridad (menor número)
    if (movingPriority > targetPriority) {
      throw Object.assign(
        new Error("role_block_violation: No puedes moverte encima de usuarios con mayor rango"), 
        { status: 409, code: "role_block_violation" }
      );
    }

    // ✅ Reordenar: sacamos y reinsertamos en el array (solo para calcular nuevos positions)
    const newQ = q.slice();
    const [item] = newQ.splice(from, 1);
    newQ.splice(to, 0, item);

    // ✅ Reindexar positions sin cambiar bloques:
    // - Para cada bloque, re-asignamos position incremental dentro de su rango.
    // Esto evita duplicados y mantiene orden estable.
    const blocks = [
      { role: "broadcaster", base: 0 },
      { role: "moderator", base: 1000 },
      { role: "vip", base: 2000 },
      { role: "subscriber", base: 3000 },
      { role: "viewer", base: 4000 },
    ];

    // Construimos map uniqueId -> newPosition
    const newPosMap = new Map();

    for (const b of blocks) {
      const bBase = b.base;
      const bUpper = bBase + 1000;

      const items = newQ.filter(u => u.position >= bBase && u.position < bUpper);

      // si aún no tenías posiciones por bloque, esto podría quedar vacío.
      // en ese caso, no reindexamos por bloque y hacemos reindex global simple.
      if (!items.length) continue;

      let p = bBase;
      for (const u of items) {
        p += 1;
        newPosMap.set(String(u.uniqueId).toLowerCase(), p);
      }
    }

    // Fallback: si no había nadie con posiciones por bloque, reindex global
    if (newPosMap.size === 0) {
      let p = 1;
      for (const u of newQ) {
        newPosMap.set(String(u.uniqueId).toLowerCase(), p++);
      }
    }

    // ✅ Aplicar updates en DB
    // (simple y seguro; para colas pequeñas va perfecto)
    for (const u of q) {
      const key = String(u.uniqueId).toLowerCase();
      const newPos = newPosMap.get(key);
      if (newPos !== undefined && newPos !== u.position) {
        await pool.query(
          `UPDATE queue_items SET position = $2 WHERE unique_id = $1`,
          [u.uniqueId, newPos]
        );
      }
    }

    await pool.query("COMMIT");
    return { ok: true, size: q.length, subCount };
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
}

module.exports = {
  getQueue,
  clearQueue,
  removeFromQueue,
  upsertByPriority,
  getQueueWithPosition,
  reorderByIndex,
};
