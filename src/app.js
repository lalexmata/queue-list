const express = require("express");
const path = require("path");

const apiRoutes = require("./routes/api");
const frontRoutes = require("./routes/front");

function createApp() {
  const app = express();

  // parsers
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // log requests (opcional)
  app.use((req, _res, next) => {
    console.log("----");
    console.log("REQ", req.method, req.url);
    next();
  });

  // estáticos
  app.use("/assets", express.static(path.join(__dirname, "assets")));
  app.get("/health", (req, res) => res.status(200).send("ok"));
  app.get("/healthz", (req, res) => res.status(200).json({ ok: true }));
  
  // rutas
  app.use("/api", apiRoutes);
  app.use("/", frontRoutes);

  // 404
  app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "pages", "404.html"));
  });

  app.use((err, req, res, next) => {
    console.error("❌ Express error:", err);
    res.status(500).json({ ok: false, error: err?.message || "internal_error" });
  });

  return app;
}

module.exports = { createApp };
