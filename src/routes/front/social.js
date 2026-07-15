const express = require("express");
const path = require("path");
const { requireSocialAuth } = require("../../middleware/auth");

const router = express.Router();
const PAGES = path.join(__dirname, "../../pages");

// Login page (pública)
router.get("/login", (req, res) => {
  if (req.session && req.session.socialAuthed) {
    return res.redirect("/social/upload");
  }
  res.sendFile(path.join(PAGES, "social-login.html"));
});

// POST login
router.post("/login", (req, res) => {
  const { password } = req.body;
  const SOCIAL_PASSWORD = process.env.SOCIAL_ADMIN_PASSWORD;

  if (!SOCIAL_PASSWORD) {
    return res.status(500).send("SOCIAL_ADMIN_PASSWORD no configurada en .env");
  }

  if (password === SOCIAL_PASSWORD) {
    req.session.socialAuthed = true;
    return res.redirect("/social/upload");
  }

  res.redirect("/social/login?error=1");
});

// Logout
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/social/login");
  });
});

// Dashboard protegido
router.get("/upload", requireSocialAuth, (req, res) => {
  res.sendFile(path.join(PAGES, "social-upload.html"));
});

module.exports = router;
