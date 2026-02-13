const express = require("express");
const path = require("path");

const apiRoutes = require("./routes/api");
const frontRoutes = require("./routes/front");

function createApp() {
  const app = express();

  // parsers
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Log ALL requests for debugging
  app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url} from ${req.ip}`);
    next();
  });

  // Health checks (IMPORTANT for Railway)
  app.get("/health", (req, res) => {
    console.log('✅ Health check called');
    res.status(200).send("ok");
  });
  
  app.get("/healthz", (req, res) => {
    console.log('✅ Healthz check called');
    res.status(200).json({ 
      ok: true, 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      env: process.env.NODE_ENV || 'development'
    });
  });
  
  // estáticos
  app.use("/assets", express.static(path.join(__dirname, "assets")));
  
  // rutas API
  app.use("/api", apiRoutes);
  
  // rutas frontend
  app.use("/", frontRoutes);

  // 404
  app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "pages", "404.html"));
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error("❌ Express error:", err);
    res.status(500).json({ ok: false, error: err?.message || "internal_error" });
  });

  return app;
}

module.exports = { createApp };
