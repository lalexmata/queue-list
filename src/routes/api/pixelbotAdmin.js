const express = require("express");
const { requireIntegrationKey } = require("../../middleware/integrationAuth");
const { listGuildSettings, updateGuildSettings } = require("../../services/pixelbot.service");
const { scheduleMessage, listScheduledMessages, cancelScheduledMessage } = require("../../services/pixelbot-messages.service");
const { getPixelBotStatus, listPixelBotChannels, sendPixelBotMessage, sendWelcomeTest } = require("../../discord/pixelbot");

const router = express.Router();
router.use(requireIntegrationKey);

function sendError(res, error) {
  const messages = {
    pixelbot_not_connected: "PixelBot no está conectado.", invalid_pixelbot_channel: "PixelBot no puede escribir en ese canal.",
    invalid_pixelbot_message: "Escribe un mensaje de entre 1 y 2000 caracteres.",
    invalid_pixelbot_schedule: "Selecciona una fecha futura válida.",
  };
  res.status(error.status || 500).json({ ok: false, error: error.message, message: messages[error.message] || "No se pudo completar la operación." });
}

router.get("/overview", async (_req, res) => {
  try { res.json({ ok: true, status: getPixelBotStatus(), guilds: await listGuildSettings() }); }
  catch (error) { sendError(res, error); }
});
router.get("/guilds/:guildId/channels", async (req, res) => {
  try { res.json({ ok: true, channels: await listPixelBotChannels(req.params.guildId) }); }
  catch (error) { sendError(res, error); }
});
router.put("/guilds/:guildId/welcome-channel", async (req, res) => {
  try {
    const settings = await updateGuildSettings(req.params.guildId, { welcomeChannelId: String(req.body.channelId || "") });
    res.json({ ok: true, settings });
  } catch (error) { sendError(res, error); }
});
router.post("/messages/send", async (req, res) => {
  try { res.json({ ok: true, message: await sendPixelBotMessage(req.body) }); }
  catch (error) { sendError(res, error); }
});
router.post("/messages/welcome-test", async (req, res) => {
  try { res.json({ ok: true, message: await sendWelcomeTest(req.body) }); }
  catch (error) { sendError(res, error); }
});
router.post("/messages/schedule", async (req, res) => {
  try { res.status(201).json({ ok: true, scheduled: await scheduleMessage(req.body) }); }
  catch (error) { sendError(res, error); }
});
router.get("/messages/scheduled", async (_req, res) => {
  try { res.json({ ok: true, messages: await listScheduledMessages() }); }
  catch (error) { sendError(res, error); }
});
router.delete("/messages/scheduled/:id", async (req, res) => {
  try { res.json({ ok: await cancelScheduledMessage(req.params.id) }); }
  catch (error) { sendError(res, error); }
});

module.exports = router;
