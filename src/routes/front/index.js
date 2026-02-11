const express = require("express");
const path = require("path");

const router = express.Router();
const PAGES = path.join(__dirname, "../../pages");

router.get("/", (req, res) => res.sendFile(path.join(PAGES, "index.html")));
router.get("/admin", (req, res) => res.sendFile(path.join(PAGES, "admin.html")));
router.get("/cola", (req, res) => res.sendFile(path.join(PAGES, "cola.html")));
router.get("/comandos-mod", (req, res) => res.sendFile(path.join(PAGES, "mod-comandos.html")));

module.exports = router;
