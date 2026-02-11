const { Pool } = require("pg");

const data = 'postgresql://neondb_owner:npg_UhugfX92IFwe@ep-damp-sound-aimbn8i9-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
const pool = new Pool({
  connectionString: data,
  ssl: { rejectUnauthorized: false }, // Neon normalmente OK así
});

module.exports = { pool };
