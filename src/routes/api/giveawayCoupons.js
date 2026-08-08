const express = require("express");
const {
  addCoupons, addCouponsForEvent, addBulkCoupons, findParticipantByUsername, getSettings, listParticipants, removeParticipant,
  setDisplayName, setSourceCount, setSourceCounts, updateSettings, getActiveGiveawayId, getActiveGiveaway,
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
  const message = error.chatMessage || messages[code] || code;
  return res.status(status).json({
    ok: false,
    status: "error",
    error: code,
    message,
    chatMessage: message,
    ...(error.refund ? {
      refund: true,
      couponCount: error.couponCount,
      limit: error.limit,
    } : {}),
  });
}

function streamerEventData(req) {
  const source = { ...req.query, ...(req.body || {}) };
  return {
    source,
    username: source.queueUser || source.username || source.userName || source.userLogin || source.twitchUsername || source.user,
    displayName: source.queueNick || source.displayName || source.userName || source.nickname || source.name,
    platform: source.queuePlatform || source.platform || "twitch",
  };
}

function subscriptionCoupons(value) {
  const normalized = String(value || "1").toLowerCase().replace(/[^0-9]/g, "");
  if (["3000", "3"].includes(normalized)) return 3;
  if (["2000", "2"].includes(normalized)) return 2;
  return 1;
}

function giveawayDateMessage(drawAt) {
  if (!drawAt) return "su fecha aún está por confirmar";
  const date = new Date(drawAt);
  if (Number.isNaN(date.getTime())) return "su fecha aún está por confirmar";
  const formatted = new Intl.DateTimeFormat("es-CL", {
    day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago",
  }).format(date);
  return `se realizará el ${formatted}`;
}

async function recordStreamerEvent(req, res, eventType) {
  try {
    const { source, username, displayName, platform } = streamerEventData(req);
    let couponCount;
    let couponSource;
    let eventAmount;
    if (eventType === "subscription") {
      couponCount = subscriptionCoupons(source.queueSubTier || source.tier || source.subTier);
      couponSource = "subscriber";
      eventAmount = couponCount;
    } else if (eventType === "gifted-subs") {
      couponCount = Number(source.queueGiftCount ?? source.count ?? source.giftCount ?? source.gifts ?? source.amount ?? source.subs ?? 1);
      couponSource = "gifted_subs";
      eventAmount = couponCount;
    } else {
      eventAmount = Number(source.queueBits ?? source.bits ?? source.amount ?? source.quantity);
      if (!Number.isInteger(eventAmount) || eventAmount < 1) {
        throw Object.assign(new Error("invalid_bits_amount"), { status: 400 });
      }
      couponCount = Math.floor(eventAmount / 100);
      couponSource = "bits";
    }
    const eventId = source.queueEventId || source.eventId || source.event_id || source.messageId || null;
    const result = await addCouponsForEvent(
      { username, displayName, platform, couponCount, source: couponSource },
      { eventId, eventType: eventType === "gifted-subs" ? "gifted_subs" : eventType, amount: eventAmount }
    );
    const participant = result.participant;
    if (result.duplicate) {
      const message = "Este evento ya había sido procesado; no se agregaron cupones duplicados.";
      return res.json({ ok: true, accepted: true, duplicate: true, couponCountAdded: 0, participant, message, chatMessage: message });
    }
    couponCount = result.couponCountAdded;
    if (eventType === "bits" && couponCount === 0) {
      const message = `${displayName || username} acumuló ${result.remainingBits} de 100 bits para su próximo cupón.`;
      return res.json({
        ok: true, accepted: true, duplicate: false, giveawayStatus: result.giveawayStatus,
        couponCountAdded: 0, totalBits: result.totalBits, remainingBits: result.remainingBits,
        message, chatMessage: message,
      });
    }
    const message = eventType === "bits"
      ? `${participant.displayName} recibió ${couponCount} cupón(es). Conserva ${result.remainingBits} bit(s) para el próximo.`
      : `${participant.displayName} recibió ${couponCount} cupón(es) por ${eventType === "gifted-subs" ? "subs regaladas" : "su suscripción"}.`;
    const finalMessage = result.giveawayStatus === "draft" ? `${message} Quedaron guardados en el próximo sorteo.` : message;
    return res.status(req.method === "GET" ? 200 : 201).json({
      ok: true, accepted: true, duplicate: false, giveawayStatus: result.giveawayStatus,
      couponCountAdded: couponCount, totalBits: result.totalBits, remainingBits: result.remainingBits,
      participant, message: finalMessage, chatMessage: finalMessage,
    });
  } catch (error) {
    if (error.message === "invalid_bits_amount") {
      error.chatMessage = "La cantidad de bits debe ser un número entero positivo. Ejemplo: bits=500.";
    }
    error.status = 200;
    return sendError(res, error);
  }
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
    try {
      await getActiveGiveawayId();
    } catch (error) {
      if (error.message !== "no_active_giveaway") throw error;
      const username = String(req.params.username || "").replace(/^@+/, "").toLowerCase();
      return res.json({
        ok: true,
        active: false,
        username,
        platform: req.query.platform || "twitch",
        couponCount: 0,
        message: "En este momento no hay un sorteo activo.",
        sources: { channelPoints: 0, subscriber: 0, giftedSubs: 0, bits: 0, purchases: 0 },
      });
    }
    const username = String(req.params.username || "").replace(/^@+/, "").toLowerCase();
    const platform = req.query.platform || "twitch";
    const participant = await findParticipantByUsername(username, platform);
    const couponCount = Number(participant?.couponCount || 0);
    res.json({
      ok: true,
      active: true,
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
        bits: Number(participant?.bitsCount || 0),
        purchases: Number(participant?.purchaseCount || 0),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

// Streamer.bot envía aquí los mensajes de chat; solo responde a "sorteo" o "sortear".
router.all("/chat/giveaway-status", async (req, res) => {
  try {
    const source = { ...req.query, ...(req.body || {}) };
    const chatText = String(source.queueMessage || source.message || source.rawInput || source.input || "").trim();
    const matchedKeyword = chatText.match(/\b(sorteo|sortear)\b/i)?.[1]?.toLowerCase() || null;
    if (!matchedKeyword) {
      return res.json({ ok: true, matched: false, message: "", chatMessage: "" });
    }
    const username = String(source.queueUser || source.username || source.userName || source.userLogin || source.user || "")
      .trim().replace(/^@+/, "").toLowerCase();
    const displayName = String(source.queueNick || source.displayName || source.userName || username).trim();
    const platform = String(source.queuePlatform || source.platform || "twitch").trim().toLowerCase();
    const giveaway = await getActiveGiveaway();
    let message;
    let couponCount = 0;
    if (!giveaway) {
      message = `@${displayName || username} por el momento no hay un sorteo activo, pero puedes seguir acumulando cupones para el próximo sorteo.`;
    } else {
      const participant = username ? await findParticipantByUsername(username, platform) : null;
      couponCount = Number(participant?.couponCount || 0);
      message = `🎟️ El sorteo ${giveaway.name} está activo y ${giveawayDateMessage(giveaway.drawAt)}. `
        + `@${displayName || username} tienes ${couponCount} cupón${couponCount === 1 ? "" : "es"}.`;
    }
    return res.json({
      ok: true, matched: true, keyword: matchedKeyword, active: Boolean(giveaway),
      giveaway, couponCount, message, chatMessage: message,
    });
  } catch (error) {
    error.status = 200;
    return sendError(res, error);
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
    if (error?.message === "no_active_giveaway") {
      error.refund = true;
      error.chatMessage = "No hay un sorteo activo. Puntos devueltos.";
    }
    if (error.refund) error.status = 200;
    sendError(res, error);
  }
});

// Integraciones GET/POST para eventos de Twitch capturados por Streamer.bot.
router.all("/events/subscription", (req, res) => recordStreamerEvent(req, res, "subscription"));
router.all("/events/gifted-subs", (req, res) => recordStreamerEvent(req, res, "gifted-subs"));
router.all("/events/bits", (req, res) => recordStreamerEvent(req, res, "bits"));

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
