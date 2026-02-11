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
  app.get("/", (req, res) => res.status(200).send("queue-list up ✅"));
  // rutas
  app.use("/api", apiRoutes);
  app.use("/", frontRoutes);

  // 404
  app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "pages", "404.html"));
  });

  return app;
}

module.exports = { createApp };
