const express = require("express");
const {
  listGiveaways, createGiveaway, updateGiveaway, activateGiveaway, finishGiveaway, setWinner, removeWinner,
} = require("../../services/giveawayRounds.service");

const router = express.Router();

function sendError(res, error) {
  const messages = {
    invalid_giveaway_name: "Escribe un nombre para el sorteo.", invalid_winner_count: "La cantidad de ganadores debe estar entre 1 y 100.",
    invalid_draw_date: "La fecha del sorteo no es válida.", active_giveaway_exists: "Finaliza el sorteo activo antes de activar otro.",
    giveaway_not_draft: "Solo se puede activar un sorteo en borrador.", giveaway_not_active: "El sorteo no está activo.",
    giveaway_not_editable: "Un sorteo finalizado no se puede editar.", invalid_winner_position: "La posición del ganador no es válida.",
    winner_position_exceeds_limit: "La posición supera la cantidad de ganadores configurada.", participant_not_found: "No se encontró el participante.",
  };
  const code = error.message || "internal_error";
  res.status(error.status || 500).json({ ok: false, error: code, message: messages[code] || "No se pudo completar la operación." });
}

router.get("/", async (_req, res) => {
  try { res.json({ ok: true, giveaways: await listGiveaways() }); } catch (error) { sendError(res, error); }
});
router.post("/", async (req, res) => {
  try { res.status(201).json({ ok: true, giveaway: await createGiveaway(req.body) }); } catch (error) { sendError(res, error); }
});
router.put("/:id", async (req, res) => {
  try { res.json({ ok: true, giveaway: await updateGiveaway(req.params.id, req.body) }); } catch (error) { sendError(res, error); }
});
router.post("/:id/activate", async (req, res) => {
  try { res.json({ ok: true, giveaway: await activateGiveaway(req.params.id) }); } catch (error) { sendError(res, error); }
});
router.post("/:id/finish", async (req, res) => {
  try { res.json({ ok: true, giveaway: await finishGiveaway(req.params.id) }); } catch (error) { sendError(res, error); }
});
router.put("/:id/winners/:position", async (req, res) => {
  try { res.json({ ok: true, giveaway: await setWinner(req.params.id, req.body?.participantId, req.params.position, req.body?.notes) }); } catch (error) { sendError(res, error); }
});
router.delete("/:id/winners/:winnerId", async (req, res) => {
  try { res.json({ ok: true, giveaway: await removeWinner(req.params.id, req.params.winnerId) }); } catch (error) { sendError(res, error); }
});

module.exports = router;
