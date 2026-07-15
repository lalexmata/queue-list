const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");
const axios = require("axios");
const { requireSocialAuth } = require("../../middleware/auth");
const SocialTokenService = require("../../services/socialTokens.service");

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

// ─── ESTADO DE TOKENS (en BD) ─────────────────────────────────────────────────

router.get("/status", requireSocialAuth, async (req, res) => {
  try {
    const youtubeToken = await SocialTokenService.getToken("youtube");
    const instagramToken = await SocialTokenService.getToken("instagram");
    const tiktokToken = await SocialTokenService.getToken("tiktok");

    const youtube = {
      connected: !!youtubeToken,
      photo: youtubeToken?.other_data?.photo_url || null,
      name: youtubeToken?.other_data?.name || null,
    };

    const instagram = {
      connected: !!instagramToken,
      photo: instagramToken?.other_data?.photo_url || null,
      name: instagramToken?.other_data?.name || null,
    };

    const tiktok = {
      connected: !!tiktokToken,
      photo: tiktokToken?.other_data?.photo_url || null,
      name: tiktokToken?.other_data?.name || null,
    };

    res.json({ youtube, instagram, tiktok });
  } catch (e) {
    console.error("Error checking token status:", e.message);
    res.json({
      youtube: { connected: false, photo: null, name: null },
      instagram: { connected: false, photo: null, name: null },
      tiktok: { connected: false, photo: null, name: null },
    });
  }
});

// ─── YOUTUBE OAUTH ────────────────────────────────────────────────────────────

router.get("/youtube/connect", requireSocialAuth, (req, res) => {
  const oauth2Client = getYouTubeOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
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
    
    // Establecer credenciales ANTES de usar la API
    oauth2Client.setCredentials(tokens);

    // Obtener info del usuario
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const channelInfo = await youtube.channels.list({
      part: "snippet",
      mine: true,
    });

    const channel = channelInfo.data.items?.[0];
    const userInfo = {
      photo_url: channel?.snippet?.thumbnails?.default?.url || null,
      name: channel?.snippet?.title || "YouTube Channel",
    };

    // Guardar en BD
    await SocialTokenService.saveToken(
      "youtube",
      tokens.access_token,
      tokens.refresh_token,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      "main",
      userInfo
    );

    res.redirect("/social/upload?connected=youtube");
  } catch (e) {
    console.error("YouTube OAuth error:", e.message);
    res.redirect("/social/upload?error=youtube_oauth");
  }
});

router.get("/youtube/disconnect", requireSocialAuth, async (req, res) => {
  try {
    await SocialTokenService.deleteToken("youtube");
    res.redirect("/social/upload?disconnected=youtube");
  } catch (e) {
    console.error("Error disconnecting YouTube:", e.message);
    res.redirect("/social/upload?error=disconnect_failed");
  }
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

    // Obtener info del usuario (foto, nombre)
    const { data: userMe } = await axios.get(
      `https://graph.instagram.com/me?fields=ig_user,username,name,profile_picture_url&access_token=${longLived.access_token}`
    );

    const userInfo = {
      photo_url: userMe.profile_picture_url || null,
      name: userMe.username || userMe.name || "Instagram User",
    };

    // Guardar en BD
    await SocialTokenService.saveToken(
      "instagram",
      longLived.access_token,
      null,
      longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null,
      data.user_id,
      userInfo
    );

    res.redirect("/social/upload?connected=instagram");
  } catch (e) {
    console.error("Instagram OAuth error:", e.response?.data || e.message);
    res.redirect("/social/upload?error=instagram_oauth");
  }
});

router.get("/instagram/disconnect", requireSocialAuth, async (req, res) => {
  try {
    await SocialTokenService.deleteToken("instagram");
    res.redirect("/social/upload?disconnected=instagram");
  } catch (e) {
    console.error("Error disconnecting Instagram:", e.message);
    res.redirect("/social/upload?error=disconnect_failed");
  }
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

    // Obtener info del usuario
    const { data: userInfo } = await axios.get(
      "https://open.tiktokapis.com/v2/user/info/",
      {
        headers: { Authorization: `Bearer ${data.access_token}` },
        params: {
          fields: "open_id,display_name,avatar_large_url,avatar_url",
        },
      }
    );

    const user = userInfo.data || {};
    console.log("TikTok User Info:", user);
    
    const userData = {
      photo_url: user.avatar_large_url || user.avatar_url || null,
      name: user.display_name || "TikTok User",
      avatar_fallback: "🎵", // Fallback emoji para TikTok
    };

    // Guardar en BD
    await SocialTokenService.saveToken(
      "tiktok",
      data.access_token,
      data.refresh_token || null,
      data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      "main",
      userData
    );

    res.redirect("/social/upload?connected=tiktok");
  } catch (e) {
    console.error("TikTok OAuth error:", e.response?.data || e.message);
    console.error("Full error:", e);
    res.redirect("/social/upload?error=tiktok_oauth");
  }
});

router.get("/tiktok/disconnect", requireSocialAuth, async (req, res) => {
  try {
    await SocialTokenService.deleteToken("tiktok");
    res.redirect("/social/upload?disconnected=tiktok");
  } catch (e) {
    console.error("Error disconnecting TikTok:", e.message);
    res.redirect("/social/upload?error=disconnect_failed");
  }
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
      const tokenData = await SocialTokenService.getToken("youtube");
      if (!tokenData) {
        results.youtube = { ok: false, error: "No conectado a YouTube" };
      } else {
        try {
          const oauth2Client = getYouTubeOAuthClient();
          oauth2Client.setCredentials({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expiry_date: tokenData.expires_at,
          });

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
          const newTokens = oauth2Client.credentials;
          if (newTokens.access_token !== tokenData.access_token) {
            await SocialTokenService.updateRefreshToken(
              "youtube",
              newTokens.access_token,
              newTokens.refresh_token,
              newTokens.expiry_date ? new Date(newTokens.expiry_date) : null
            );
          }

          results.youtube = { ok: true, videoId: response.data.id };
        } catch (e) {
          results.youtube = { ok: false, error: e.message };
        }
      }
    }

    // ── Instagram (Reels) ──
    if (selectedPlatforms.includes("instagram")) {
      const tokenData = await SocialTokenService.getToken("instagram");
      if (!tokenData) {
        results.instagram = { ok: false, error: "No conectado a Instagram" };
      } else {
        try {
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
      const tokenData = await SocialTokenService.getToken("tiktok");
      if (!tokenData) {
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
            { headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" } }
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
