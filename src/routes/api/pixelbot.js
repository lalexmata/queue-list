const express = require("express");
const { requireIntegrationKey } = require("../../middleware/integrationAuth");
const { getPlayerStats } = require("../../services/fortnite.service");
const { getFortniteAccount, getBirthday, saveBirthday, listBirthdays } = require("../../services/pixelbot.service");

const router = express.Router();

function sendError(res, error) {
  const messages = {
    invalid_player_name: "Escribe un nombre válido de Epic.", fortnite_not_configured: "La API de Fortnite todavía no está configurada.",
    player_not_found: "No encontré ese jugador.", player_stats_private: "Las estadísticas de ese jugador son privadas.",
    fortnite_rate_limited: "Se alcanzó temporalmente el límite de consultas.", fortnite_unavailable: "Fortnite-API no está disponible en este momento.",
    invalid_birthday: "La fecha de cumpleaños no es válida.", account_not_linked: "El usuario no tiene una cuenta de Fortnite vinculada.",
  };
  const code = error.message || "internal_error";
  res.status(error.status || 500).json({ ok: false, error: code, message: messages[code] || "No se pudo completar la solicitud." });
}

router.get("/fortnite/stats", requireIntegrationKey, async (req, res) => {
  try {
    let name = String(req.query.name || "").trim();
    if (!name && req.query.guildId && req.query.discordUserId) {
      const linked = await getFortniteAccount(req.query.guildId, req.query.discordUserId);
      if (!linked) throw Object.assign(new Error("account_not_linked"), { status: 404 });
      name = linked.epicName;
    }
    const stats = await getPlayerStats(name, req.query.timeWindow);
    res.json({ ok: true, stats, message: `${stats.name}: ${stats.wins} victorias, ${stats.kills} eliminaciones, K/D ${stats.kd.toFixed(2)}.` });
  } catch (error) { sendError(res, error); }
});

router.get("/birthdays/:guildId/:discordUserId", requireIntegrationKey, async (req, res) => {
  try {
    const birthday = await getBirthday(req.params.guildId, req.params.discordUserId);
    res.json({ ok: true, birthday, message: birthday ? `Cumpleaños: ${birthday.day}/${birthday.month}.` : "No hay cumpleaños registrado." });
  } catch (error) { sendError(res, error); }
});

router.get("/birthdays/:guildId", requireIntegrationKey, async (req, res) => {
  try {
    const birthdays = await listBirthdays(req.params.guildId);
    res.json({ ok: true, count: birthdays.length, birthdays });
  } catch (error) { sendError(res, error); }
});

router.put("/birthdays/:guildId/:discordUserId", requireIntegrationKey, async (req, res) => {
  try {
    const birthday = await saveBirthday({ guildId: req.params.guildId, discordUserId: req.params.discordUserId, ...req.body });
    res.json({ ok: true, birthday, message: `Cumpleaños guardado: ${birthday.day}/${birthday.month}.` });
  } catch (error) { sendError(res, error); }
});

module.exports = router;
