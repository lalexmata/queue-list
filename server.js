// Cargar variables de entorno
require('dotenv').config();

// Manejo de errores no capturados
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  console.error(err.stack);
  // No salir inmediatamente en Railway, intentar recuperarse
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  // No salir inmediatamente
});

const { createApp } = require("./src/app");

console.log('🔧 Starting application...');
console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`📍 PORT: ${process.env.PORT || 8080}`);
console.log(`💾 DATABASE_URL: ${process.env.DATABASE_URL ? 'configured' : 'NOT configured'}`);

const app = createApp();

app.get("/health", (_, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`✅ Server successfully started`);
  console.log(`🚀 Listening on ${HOST}:${PORT}`);
  console.log(`🔗 Health check: http://${HOST}:${PORT}/health`);
});

server.on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`⚠️  Port ${PORT} is already in use`);
  }
  process.exit(1);
});

// Manejo de señales para shutdown graceful
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('👋 Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('👋 Server closed');
    process.exit(0);
  });
});