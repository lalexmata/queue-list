const { Pool } = require("pg");

// Usar variable de entorno para la URL de conexión
const connectionString = process.env.DATABASE_URL || process.env.DB_URL;

if (!connectionString) {
  console.error('⚠️  No DATABASE_URL or DB_URL environment variable found');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false,
});

// Verificar conexión al iniciar
pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
});

module.exports = { pool };
