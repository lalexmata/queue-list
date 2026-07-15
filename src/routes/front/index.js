const express = require("express");
const path = require("path");

const router = express.Router();
const PAGES = path.join(__dirname, "../../pages");

router.get("/", (req, res) => res.sendFile(path.join(PAGES, "index.html")));
router.get("/admin", (req, res) => res.sendFile(path.join(PAGES, "admin.html")));
router.get("/cola", (req, res) => res.sendFile(path.join(PAGES, "cola.html")));
router.get("/comandos-mod", (req, res) => res.sendFile(path.join(PAGES, "mod-comandos.html")));
router.get("/admin-countdown", (req, res) => res.sendFile(path.join(PAGES, "admin-countdown.html")));
router.get("/overlays/countdown", (req, res) => res.sendFile(path.join(PAGES, "countdown.html")));

// Legal pages for TikTok
router.get("/terms", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Términos de Servicio</title></head>
    <body style="font-family: sans-serif; padding: 20px;">
      <h1>Términos de Servicio</h1>
      <p>Social Manager es una herramienta para gestionar contenido en redes sociales.</p>
      <p>Al usar esta aplicación, aceptas estos términos.</p>
    </body>
    </html>
  `);
});

router.get("/privacy", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Política de Privacidad</title></head>
    <body style="font-family: sans-serif; padding: 20px;">
      <h1>Política de Privacidad</h1>
      <p>Tu información está protegida. No compartimos datos personales con terceros.</p>
    </body>
    </html>
  `);
});

module.exports = router;
