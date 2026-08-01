require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  const requested = process.argv[2];
  if (!requested || !/^[a-z0-9_-]+\.sql$/i.test(requested)) {
    throw new Error("Uso: node scripts/run-migration.js nombre_migracion.sql");
  }

  const connectionString = process.env.DATABASE_URL || process.env.DB_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL o DB_URL");

  const migrationPath = path.join(__dirname, "..", "migrations", requested);
  const sql = fs.readFileSync(migrationPath, "utf8");
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query(sql);
    console.log(`Migración aplicada: ${requested}`);
    if (requested === "add_pixelbot.sql") {
      const { rows } = await pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('discord_guild_settings', 'fortnite_accounts', 'discord_birthdays', 'birthday_announcements')
         ORDER BY table_name`
      );
      console.log(`Tablas verificadas: ${rows.map(row => row.table_name).join(", ")}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`Error de migración: ${error.message}`);
  process.exit(1);
});
