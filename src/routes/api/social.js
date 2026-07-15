const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");
const axios = require("axios");
const { requireSocialAuth } = require("../../middleware/auth");

const router = express.Router();

// Almacenamiento temporal de videos
const upload = multer({
  dest: path.join(__dirname, "../../uploads/"),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB máximo
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos de video"));
    }
  },
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getYouTubeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
}

// ─── ESTADO DE TOKENS (en sesión) ─────────────────────────────────────────────

router.get("/status", requireSocialAuth, (req, res) => {
  res.json({
    youtube: !!req.session.youtubeTokens,
    instagram: !!req.session.instagramToken,
    tiktok: !!req.session.tiktokToken,
  });
});

// ─── YOUTUBE OAUTH ────────────────────────────────────────────────────────────

router.get("/youtube/connect", requireSocialAuth, (req, res) => {
  const oauth2Client = getYouTubeOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/youtube.upload"],
    prompt: "consent",
  });
  res.redirect(url);
});

router.get("/youtube/callback", requireSocialAuth, async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect("/social/upload?error=youtube_denied");

  try {
    const oauth2Client = getYouTubeOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    req.session.youtubeTokens = tokens;
    res.redirect("/social/upload?connected=youtube");
  } catch (e) {
    console.error("YouTube OAuth error:", e.message);
    res.redirect("/social/upload?error=youtube_oauth");
  }
});

router.get("/youtube/disconnect", requireSocialAuth, (req, res) => {
  delete req.session.youtubeTokens;
  res.redirect("/social/upload?disconnected=youtube");
});

// ─── INSTAGRAM OAUTH (Meta Graph API) ────────────────────────────────────────

router.get("/instagram/connect", requireSocialAuth, (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    scope: "instagram_basic,instagram_content_publish",
    response_type: "code",
  });
  res.redirect(`https://api.instagram.com/oauth/authorize?${params}`);
});

router.get("/instagram/callback", requireSocialAuth, async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect("/social/upload?error=instagram_denied");

  try {
    const form = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      code,
    });

    const { data } = await axios.post(
      "https://api.instagram.com/oauth/access_token",
      form.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    // Obtener token de larga duración
    const { data: longLived } = await axios.get(
      "https://graph.instagram.com/access_token",
      {
        params: {
          grant_type: "ig_exchange_token",
          client_secret: process.env.INSTAGRAM_APP_SECRET,
          access_token: data.access_token,
        },
      }
    );

    req.session.instagramToken = longLived.access_token;
    req.session.instagramUserId = data.user_id;
    res.redirect("/social/upload?connected=instagram");
  } catch (e) {
    console.error("Instagram OAuth error:", e.response?.data || e.message);
    res.redirect("/social/upload?error=instagram_oauth");
  }
});

router.get("/instagram/disconnect", requireSocialAuth, (req, res) => {
  delete req.session.instagramToken;
  delete req.session.instagramUserId;
  res.redirect("/social/upload?disconnected=instagram");
});

// ─── TIKTOK OAUTH ─────────────────────────────────────────────────────────────

router.get("/tiktok/connect", requireSocialAuth, (req, res) => {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    scope: "video.upload",
    response_type: "code",
    redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    state: "tiktok_oauth",
  });
  res.redirect(`https://www.tiktok.com/v2/auth/authorize?${params}`);
});

router.get("/tiktok/callback", requireSocialAuth, async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect("/social/upload?error=tiktok_denied");

  try {
    const { data } = await axios.post(
      "https://open.tiktokapis.com/v2/oauth/token/",
      new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.TIKTOK_REDIRECT_URI,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    req.session.tiktokToken = data.access_token;
    res.redirect("/social/upload?connected=tiktok");
  } catch (e) {
    console.error("TikTok OAuth error:", e.response?.data || e.message);
    res.redirect("/social/upload?error=tiktok_oauth");
  }
});

router.get("/tiktok/disconnect", requireSocialAuth, (req, res) => {
  delete req.session.tiktokToken;
  res.redirect("/social/upload?disconnected=tiktok");
});

// ─── UPLOAD ───────────────────────────────────────────────────────────────────

router.post("/upload", requireSocialAuth, upload.single("video"), async (req, res) => {
  const { title, description, platforms } = req.body;
  const selectedPlatforms = Array.isArray(platforms) ? platforms : [platforms].filter(Boolean);
  const file = req.file;

  if (!file) {
    return res.status(400).json({ ok: false, error: "No se recibió ningún archivo de video" });
  }

  const results = {};

  try {
    // ── YouTube ──
    if (selectedPlatforms.includes("youtube")) {
      if (!req.session.youtubeTokens) {
        results.youtube = { ok: false, error: "No conectado a YouTube" };
      } else {
        try {
          const oauth2Client = getYouTubeOAuthClient();
          oauth2Client.setCredentials(req.session.youtubeTokens);

          const yt = google.youtube({ version: "v3", auth: oauth2Client });
          const response = await yt.videos.insert({
            part: ["snippet", "status"],
            requestBody: {
              snippet: { title, description, categoryId: "22" },
              status: { privacyStatus: "public" },
            },
            media: {
              body: fs.createReadStream(file.path),
            },
          });

          // Actualizar tokens si fueron refrescados
          req.session.youtubeTokens = oauth2Client.credentials;
          results.youtube = { ok: true, videoId: response.data.id };
        } catch (e) {
          results.youtube = { ok: false, error: e.message };
        }
      }
    }

    // ── Instagram (Reels) ──
    if (selectedPlatforms.includes("instagram")) {
      if (!req.session.instagramToken) {
        results.instagram = { ok: false, error: "No conectado a Instagram" };
      } else {
        try {
          const token = req.session.instagramToken;
          const userId = req.session.instagramUserId;

          // Nota: Instagram requiere una URL pública del video, no subida directa.
          // Debes alojar el video en un servidor accesible antes de publicar.
          results.instagram = {
            ok: false,
            error: "Instagram requiere una URL pública del video. Contacta soporte para configurar el almacenamiento.",
          };
        } catch (e) {
          results.instagram = { ok: false, error: e.message };
        }
      }
    }

    // ── TikTok ──
    if (selectedPlatforms.includes("tiktok")) {
      if (!req.session.tiktokToken) {
        results.tiktok = { ok: false, error: "No conectado a TikTok" };
      } else {
        try {
          // Iniciar subida directa
          const { data: initData } = await axios.post(
            "https://open.tiktokapis.com/v2/post/publish/video/init/",
            {
              post_info: { title, privacy_level: "PUBLIC_TO_EVERYONE", disable_duet: false, disable_comment: false, disable_stitch: false },
              source_info: { source: "FILE_UPLOAD", video_size: file.size, chunk_size: file.size, total_chunk_count: 1 },
            },
            { headers: { Authorization: `Bearer ${req.session.tiktokToken}`, "Content-Type": "application/json" } }
          );

          const { upload_url, publish_id } = initData.data;

          // Subir el archivo
          await axios.put(upload_url, fs.createReadStream(file.path), {
            headers: {
              "Content-Type": "video/mp4",
              "Content-Length": file.size,
              "Content-Range": `bytes 0-${file.size - 1}/${file.size}`,
            },
          });

          results.tiktok = { ok: true, publishId: publish_id };
        } catch (e) {
          results.tiktok = { ok: false, error: e.response?.data?.error?.message || e.message };
        }
      }
    }

    res.json({ ok: true, results });
  } finally {
    // Eliminar archivo temporal
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
});

module.exports = router;
