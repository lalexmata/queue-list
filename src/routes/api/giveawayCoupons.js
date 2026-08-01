const express = require("express");
const {
  addCoupons, addBulkCoupons, findParticipantByUsername, getSettings, listParticipants, removeParticipant,
  setDisplayName, setSourceCount, setSourceCounts, updateSettings,
} = require("../../services/giveawayCoupons.service");
const { listGuildSettings, updateGuildSettings } = require("../../services/pixelbot.service");

const router = express.Router();

function sendError(res, error) {
  console.error("Giveaway coupons error:", error);
  const status = error.status || 500;
  const code = error.status ? error.message : "db_error";
  const messages = {
    invalid_username: "Ingresa un nombre de usuario válido.",
    invalid_platform: "Selecciona una plataforma válida.",
    invalid_participant_list: "La lista debe contener entre 1 y 5.000 participantes válidos.",
    invalid_coupon_count: "La cantidad de cupones debe ser un número entero válido.",
    invalid_coupon_source: "Selecciona un origen de cupón válido.",
    invalid_display_name: "Ingresa un nombre visible válido.",
    participant_not_found: "No se encontró al participante.",
    subscriber_coupon_limit: "Los cupones de suscripción deben estar entre 0 y 3, según el tier.",
    channel_points_limit_reached: "La cantidad supera el límite de canjes con puntos configurado.",
    no_active_giveaway: "No hay un sorteo activo. Crea o activa uno desde la configuración.",
    db_error: "No se pudo procesar la solicitud en la base de datos.",
  };
  return res.status(status).json({
    ok: false,
    error: code,
    message: error.chatMessage || messages[code] || code,
    ...(error.refund ? {
      refund: true,
      couponCount: error.couponCount,
      limit: error.limit,
    } : {}),
  });
}

router.get("/", async (req, res) => {
  try {
    const participants = await listParticipants(req.query.giveawayId || null);
    const totalCoupons = participants.reduce((total, item) => total + Number(item.couponCount), 0);
    res.json({ ok: true, participants, totalParticipants: participants.length, totalCoupons });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/settings", async (_req, res) => {
  try {
    res.json({ ok: true, settings: await getSettings() });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/settings", async (req, res) => {
  try {
    res.json({ ok: true, settings: await updateSettings(req.body?.channelPointsLimit) });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/discord-guilds", async (_req, res) => {
  try {
    res.json({ ok: true, guilds: await listGuildSettings() });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/discord-guilds/:guildId/active", async (req, res) => {
  try {
    if (typeof req.body?.active !== "boolean") {
      return res.status(400).json({ ok: false, error: "invalid_active_status", message: "El estado del sorteo no es válido." });
    }
    const settings = await updateGuildSettings(req.params.guildId, { giveawayActive: req.body.active });
    res.json({ ok: true, settings, message: req.body.active ? "Sorteo activado." : "Sorteo desactivado." });
  } catch (error) {
    sendError(res, error);
  }
});

// Endpoint simple para que el bot consulte y publique directamente el campo "message".
router.get("/user/:username", async (req, res) => {
  try {
    const username = String(req.params.username || "").replace(/^@+/, "").toLowerCase();
    const platform = req.query.platform || "twitch";
    const participant = await findParticipantByUsername(username, platform);
    const couponCount = Number(participant?.couponCount || 0);
    res.json({
      ok: true,
      username,
      platform,
      couponCount,
      message: couponCount === 0
        ? `@${username} no tienes cupones para el sorteo 😢`
        : `@${username} tienes ${couponCount} cupón${couponCount === 1 ? "" : "es"} para el sorteo`,
      sources: {
        channelPoints: Number(participant?.channelPointsCount || 0),
        subscriber: Number(participant?.subscriberCount || 0),
        giftedSubs: Number(participant?.giftedSubsCount || 0),
        purchases: Number(participant?.purchaseCount || 0),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

// Admite JSON o query params para integraciones como Streamer.bot.
router.all("/redeem", async (req, res) => {
  try {
    const source = { ...req.query, ...(req.body || {}) };
    const participant = await addCoupons({
      username: source.username || source.twitchUsername || source.user || source.uniqueId,
      displayName: source.displayName || source.nickname || source.name,
      platform: source.platform || "twitch",
      couponCount: source.couponCount ?? source.coupons ?? source.amount ?? 1,
      source: source.couponSource || source.origin || source.couponOrigin || "channel_points",
    });
    res.status(req.method === "GET" ? 200 : 201).json({
      ok: true,
      accepted: true,
      refund: false,
      participant,
      message: `${participant.displayName} ahora tiene ${participant.couponCount} cupón(es).`,
    });
  } catch (error) {
    // Streamer.bot debe poder leer el JSON y decidir si cancela/reembolsa el canje.
    if (error.refund) error.status = 200;
    sendError(res, error);
  }
});

router.post("/bulk", async (req, res) => {
  try {
    const participants = await addBulkCoupons(req.body?.participants);
    res.status(201).json({
      ok: true, imported: participants.length,
      message: `Se importaron ${participants.length} participante(s).`,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/:id/source/:source", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    const participant = await setSourceCount(req.params.id, req.params.source, req.body?.couponCount);
    if (!participant) return sendError(res, Object.assign(new Error("participant_not_found"), { status: 404 }));
    res.json({ ok: true, participant });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/:id/sources", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    const participant = await setSourceCounts(req.params.id, req.body);
    if (!participant) return sendError(res, Object.assign(new Error("participant_not_found"), { status: 404 }));
    res.json({ ok: true, participant });
  } catch (error) {
    sendError(res, error);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    const participant = await setDisplayName(req.params.id, req.body?.displayName);
    if (!participant) return sendError(res, Object.assign(new Error("participant_not_found"), { status: 404 }));
    res.json({ ok: true, participant });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    const participant = await removeParticipant(req.params.id);
    if (!participant) return sendError(res, Object.assign(new Error("participant_not_found"), { status: 404 }));
    res.json({ ok: true, participant });
  } catch (error) {
    sendError(res, error);
  }
});

module.exports = router;
