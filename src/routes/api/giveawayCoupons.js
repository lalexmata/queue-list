const express = require("express");
const {
  addCoupons,
  addBulkCoupons,
  listParticipants,
  removeParticipant,
  setCouponCount,
} = require("../../services/giveawayCoupons.service");

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
    participant_not_found: "No se encontró al participante.",
    db_error: "No se pudo procesar la solicitud en la base de datos.",
  };
  return res.status(status).json({ ok: false, error: code, message: messages[code] || code });
}

router.get("/", async (_req, res) => {
  try {
    const participants = await listParticipants();
    const totalCoupons = participants.reduce((total, item) => total + Number(item.couponCount), 0);
    res.json({ ok: true, participants, totalParticipants: participants.length, totalCoupons });
  } catch (error) {
    sendError(res, error);
  }
});

// Admite JSON o query params para facilitar la integración con Streamer.bot.
router.all("/redeem", async (req, res) => {
  try {
    const source = { ...req.query, ...(req.body || {}) };
    const participant = await addCoupons({
      username: source.username || source.twitchUsername || source.user || source.uniqueId,
      displayName: source.displayName || source.nickname || source.name,
      platform: source.platform || source.source || "twitch",
      couponCount: source.couponCount ?? source.coupons ?? source.amount ?? 1,
    });
    res.status(req.method === "GET" ? 200 : 201).json({
      ok: true,
      participant,
      message: `${participant.displayName} ahora tiene ${participant.couponCount} cupón(es).`,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/bulk", async (req, res) => {
  try {
    const participants = await addBulkCoupons(req.body?.participants);
    res.status(201).json({
      ok: true,
      imported: participants.length,
      message: `Se importaron ${participants.length} participante(s).`,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    const participant = await setCouponCount(req.params.id, req.body?.couponCount);
    if (!participant) {
      return sendError(res, Object.assign(new Error("participant_not_found"), { status: 404 }));
    }
    res.json({ ok: true, participant });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    const participant = await removeParticipant(req.params.id);
    if (!participant) {
      return sendError(res, Object.assign(new Error("participant_not_found"), { status: 404 }));
    }
    res.json({ ok: true, participant });
  } catch (error) {
    sendError(res, error);
  }
});

module.exports = router;
