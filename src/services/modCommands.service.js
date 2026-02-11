const { pool } = require("../database/db");

async function listModCommands() {
  const { rows } = await pool.query(
    `SELECT command, description, created_at AS "createdAt"
     FROM mod_commands
     ORDER BY created_at DESC`
  );
  return rows;
}

async function addModCommand(command, description) {
  const cmd = String(command || "").trim();
  const desc = String(description || "").trim();

  if (!cmd || !desc) {
    return { ok: false, error: "missing_command_or_description" };
  }

  try {
    await pool.query(
      `INSERT INTO mod_commands (command, description)
       VALUES ($1, $2)`,
      [cmd, desc]
    );
    return { ok: true };
  } catch (e) {
    // unique violation
    if (String(e.code) === "23505") {
      // si existe, actualizamos (upsert manual)
      await pool.query(
        `UPDATE mod_commands
         SET description = $2
         WHERE command = $1`,
        [cmd, desc]
      );
      return { ok: true, updated: true };
    }
    throw e;
  }
}

async function deleteModCommand(command) {
  const cmd = String(command || "").trim();
  if (!cmd) return { ok: false, error: "missing_command" };

  const { rowCount } = await pool.query(
    `DELETE FROM mod_commands WHERE command = $1`,
    [cmd]
  );

  return { ok: true, deleted: rowCount > 0 };
}

module.exports = {
  listModCommands,
  addModCommand,
  deleteModCommand,
};
