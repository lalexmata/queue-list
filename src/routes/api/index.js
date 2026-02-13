const express = require("express");
const router = express.Router();

const { 
  getQueue, 
  clearQueue, 
  removeFromQueue, 
  upsertByPriority, 
  reorderByIndex } = require("../../services/queue.service");
const {
  listModCommands,
  addModCommand,
  deleteModCommand,
} = require("../../services/modCommands.service");
const { resolveRole } = require("../../helpers/helpers");

// /api/cola
router.get("/cola", async (req, res) => {
  try {
    const data = await getQueue(); // tu consulta a Neon
    res.json({ ok: true, queue: data });
  } catch (e) {
    console.error("❌ /api/cola error:", e);
    res.status(500).json({ ok: false, error: "db_error", detail: e.message });
  }
});

// /api/limpiar
router.post("/limpiar", async (_req, res) => {
  await clearQueue();
  res.json({ ok: true, size: 0 });
});

// /api/remove?uniqueId=...
router.post("/remove", async (req, res) => {
  const uniqueId = String(req.query.uniqueId || "").trim();
  if (!uniqueId) return res.status(400).json({ ok: false, error: "missing uniqueId" });

  const ok = await removeFromQueue(uniqueId);
  res.json({ ok: true, removed: ok });
});

// /api/jugar
router.all("/jugar", async (req, res) => {
  const uniqueId =
    (req.body && (req.body.uniqueId || req.body.uniqueid || req.body.user || req.body.username)) ||
    req.query.uniqueId || req.query.uniqueid || req.query.user || req.query.username || "";

  const nickname =
    (req.body && (req.body.nickname || req.body.displayName || req.body.name)) ||
    req.query.nickname || req.query.displayName || req.query.name || uniqueId;

  const platform =
    (req.body && req.body.platform) ||
    req.query.platform || "unknown";

  if (!uniqueId || String(uniqueId).includes("{") || String(uniqueId).includes("%")) {
    return res.status(400).json({ ok: false, error: "invalid uniqueId" });
  }

  // role lo calculas como ya lo vienes haciendo (o lo dejas viewer si no viene)
  const role = resolveRole({ ...req.query, ...(req.body || {}) }, uniqueId);
  console.log("API /jugar data", { uniqueId, nickname, role, platform });

  const pos = await upsertByPriority({
    uniqueId: String(uniqueId),
    nickname: String(nickname || uniqueId),
    role,
    platform: String(platform),
  });

  const queue = await getQueue();
  res.json({ ok: true, status: "ok", pos: queue.findIndex(u => u.uniqueId.toLowerCase() === String(uniqueId).toLowerCase()) + 1, size: queue.length });
});

// POST /api/reorder  body: { from: 0, to: 3 }
router.post("/reorder", async (req, res) => {
  const from = Number(req.body?.from);
  const to = Number(req.body?.to);

  try {
    const result = await reorderByIndex(from, to);
    return res.json(result);
  } catch (e) {
    const status = e.status || 500;
    const code = e.code || e.message || "error";
    return res.status(status).json({ ok: false, error: code, code: code, message: e.message });
  }
});



/**
 * comandos para apartado de mods
 */

// ✅ GET /api/comandos-mod
router.get("/comandos-mod", async (_req, res) => {
  const items = await listModCommands();
  res.json({ ok: true, items });
});

// ✅ POST /api/comandos-mod/add
// body: { command: "!limpiar", description: "Limpia la cola completa" }
router.post("/comandos-mod/add", async (req, res) => {
  const { command, description } = req.body || {};
  const result = await addModCommand(command, description);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// ✅ POST /api/comandos-mod/delete
// body: { command: "!limpiar" }
router.post("/comandos-mod/delete", async (req, res) => {
  const { command } = req.body || {};
  const result = await deleteModCommand(command);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

module.exports = router;
