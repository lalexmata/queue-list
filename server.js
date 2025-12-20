const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");
const CSV_FILE = path.join(DATA_DIR, "queue.csv");

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, JSON.stringify({ queue: [] }, null, 2), "utf8");
  if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, "pos,uniqueId,nickname,ts\n", "utf8");
}

function loadQueue() {
  ensureFiles();
  return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8")).queue || [];
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify({ queue }, null, 2), "utf8");
  // Reescribe CSV completo (simple y seguro)
  const header = "pos,uniqueId,nickname,ts\n";
  const lines = queue.map((u, i) => `${i + 1},${u.uniqueId},${u.nickname},${u.ts}`).join("\n");
  fs.writeFileSync(CSV_FILE, header + (lines ? lines + "\n" : ""), "utf8");
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log("----");
  console.log("REQ", req.method, req.url);
  console.log("QUERY", req.query);
  console.log("BODY", req.body);
  next();
});

// Endpoint para !jugar
app.all("/jugar", (req, res) => {
  const uniqueId =
    (req.body && (req.body.uniqueId || req.body.user || req.body.username)) ||
    req.query.uniqueId ||
    req.query.user ||
    req.query.username ||
    req.query.uniqueid || // por si viene en minúsculas
    "";

  const nickname =
    (req.body && (req.body.nickname || req.body.displayName)) ||
    req.query.nickname ||
    req.query.displayName ||
    req.query.name ||
    uniqueId;

  // Si TikFinity no manda usuario en "Test", igual guardamos un registro de prueba
  const finalId = String(uniqueId || `test_${Date.now()}`).trim();
  const finalNick = String(nickname || finalId).trim();

  const queue = loadQueue();
  const already = queue.findIndex(u => u.uniqueId.toLowerCase() === finalId.toLowerCase());

  if (already === -1) {
    queue.push({ uniqueId: finalId, nickname: finalNick, ts: new Date().toISOString() });
    saveQueue(queue);
    return res.json({ ok: true, status: "added", pos: queue.length, note: uniqueId ? "from_user" : "no_user_received" });
  }

  return res.json({ ok: true, status: "already_in_queue", pos: already + 1 });
});
// Endpoint para ver cola
app.get("/lista", (req, res) => {
  const queue = loadQueue();
  res.json({ ok: true, size: queue.length, queue });
});

// Endpoint para sacar al siguiente
app.post("/siguiente", (req, res) => {
  const queue = loadQueue();
  const next = queue.shift() || null;
  saveQueue(queue);
  res.json({ ok: true, next, size: queue.length });
});

// Endpoint para salir
app.post("/salir", (req, res) => {
  const uniqueId = String(req.body.uniqueId || "").trim();
  const queue = loadQueue();
  const idx = queue.findIndex(u => u.uniqueId.toLowerCase() === uniqueId.toLowerCase());
  if (idx === -1) return res.json({ ok: true, status: "not_in_queue", size: queue.length });

  const removed = queue.splice(idx, 1)[0];
  saveQueue(queue);
  res.json({ ok: true, status: "removed", removed, size: queue.length });
});

const PORT = 5005;
app.listen(PORT, () => console.log(`TikQueue server running on http://127.0.0.1:${PORT}`));
