const express = require("express");
const path = require("path");
const session = require("express-session");

const apiRoutes = require("./routes/api");
const frontRoutes = require("./routes/front");
const socialFrontRoutes = require("./routes/front/social");
const socialApiRoutes = require("./routes/api/social");
const songRequestApiRoutes = require("./routes/api/songRequest");
const giveawayCouponsApiRoutes = require("./routes/api/giveawayCoupons");
const pixelbotApiRoutes = require("./routes/api/pixelbot");
const pixelbotAdminApiRoutes = require("./routes/api/pixelbotAdmin");
const giveawayRoundsApiRoutes = require("./routes/api/giveawayRounds");

function createApp() {
  const app = express();

  // sesión
  app.use(session({
    secret: process.env.SESSION_SECRET || "change_this_secret_in_env",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 }, // 8 horas
  }));

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
  
  // rutas API (social primero para evitar que /api capture /api/social)
  app.use("/api/social", socialApiRoutes);
  app.use("/api/song-request", songRequestApiRoutes);
  app.use("/api/giveaway-coupons", giveawayCouponsApiRoutes);
  app.use("/api/giveaways", giveawayRoundsApiRoutes);
  app.use("/api/pixelbot", pixelbotApiRoutes);
  app.use("/api/pixelbot-admin", pixelbotAdminApiRoutes);
  app.use("/api", apiRoutes);

  // rutas frontend
  app.use("/social", socialFrontRoutes);
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
