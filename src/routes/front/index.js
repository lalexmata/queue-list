const express = require("express");
const path = require("path");
const { requireSocialAuth } = require("../../middleware/auth");

const router = express.Router();
const PAGES = path.join(__dirname, "../../pages");

router.get("/", (req, res) => res.sendFile(path.join(PAGES, "index.html")));
router.get("/admin", (req, res) => res.sendFile(path.join(PAGES, "admin.html")));
router.get("/admin/song-request", (req, res) => res.sendFile(path.join(PAGES, "admin-song-request.html")));
router.get("/admin/sorteos", (req, res) => res.sendFile(path.join(PAGES, "admin-giveaway-coupons.html")));
router.get("/admin/sorteos/configuracion", (req, res) => res.sendFile(path.join(PAGES, "admin-giveaways.html")));
router.get("/admin/cumpleanos", (req, res) => res.sendFile(path.join(PAGES, "admin-birthdays.html")));
router.get("/admin/comunidad", (req, res) => res.sendFile(path.join(PAGES, "admin-birthdays.html")));
router.get("/admin/pixelbot", requireSocialAuth, (req, res) => res.sendFile(path.join(PAGES, "admin-pixelbot.html")));
router.get("/cola", (req, res) => res.sendFile(path.join(PAGES, "cola.html")));
router.get("/widgets/social", (req, res) => res.sendFile(path.join(PAGES, "widgets/socialrotator.html")));
router.get("/widgets/codigo", (req, res) => res.sendFile(path.join(PAGES, "widgets/codigo.html")));
router.get("/widgets/song-request", (req, res) => res.sendFile(path.join(PAGES, "widgets/song-request.html")));
router.get("/widgets/lalex-personaje.png", (req, res) =>
  res.sendFile(path.join(PAGES, "widgets/lalex-personaje.png"))
);
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
