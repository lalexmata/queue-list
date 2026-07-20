const express = require("express");
const path = require("path");

const router = express.Router();
const PAGES = path.join(__dirname, "../../pages");

router.get("/", (req, res) => res.sendFile(path.join(PAGES, "index.html")));
router.get("/admin", (req, res) => res.sendFile(path.join(PAGES, "admin.html")));
router.get("/cola", (req, res) => res.sendFile(path.join(PAGES, "cola.html")));
router.get("/widgets/social", (req, res) => res.sendFile(path.join(PAGES, "widgets/socialrotator.html")));
router.get("/widgets/codigo", (req, res) => res.sendFile(path.join(PAGES, "widgets/codigo.html")));
router.get("/widgets/lalex-personaje.png", (req, res) =>
  res.sendFile(path.join(PAGES, "widgets/lalex-personaje.png"))
);
router.get("/comandos-mod", (req, res) => res.sendFile(path.join(PAGES, "mod-comandos.html")));
router.get("/admin-countdown", (req, res) => res.sendFile(path.join(PAGES, "admin-countdown.html")));
router.get("/overlays/countdown", (req, res) => res.sendFile(path.join(PAGES, "countdown.html")));
module.exports = router;
