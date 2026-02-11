const path = require("path");
const fs = require("fs");

const MOD_COMMANDS_PATH = path.join(__dirname, "data", "mod_commands.json");
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // ponla en Railway Variables
const BROADCASTER_LOGIN = (process.env.BROADCASTER_LOGIN || "lalexmata").toLowerCase();
// Orden de prioridad (0 = más alto)
const ROLE_BLOCK = {
  broadcaster: 0,
  moderator: 1000,
  vip: 2000,
  subscriber: 3000,
  viewer: 4000,
};

function ensureModCommandsFile() {
  if (!fs.existsSync(path.dirname(MOD_COMMANDS_PATH))) {
    fs.mkdirSync(path.dirname(MOD_COMMANDS_PATH), { recursive: true });
  }
  if (!fs.existsSync(MOD_COMMANDS_PATH)) {
    fs.writeFileSync(MOD_COMMANDS_PATH, "[]", "utf8");
  }
}

function loadModCommands() {
  ensureModCommandsFile();
  try {
    return JSON.parse(fs.readFileSync(MOD_COMMANDS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveModCommands(list) {
  ensureModCommandsFile();
  fs.writeFileSync(MOD_COMMANDS_PATH, JSON.stringify(list, null, 2), "utf8");
}

function isAdmin(req) {
  // Permite por query ?key= o por header x-admin-key
  const key = String(req.query.key || req.headers["x-admin-key"] || "");
  if (!ADMIN_KEY) return true; // si no configuras ADMIN_KEY, queda abierto
  return key === ADMIN_KEY;
}

function toBool(v) {
  return v === true || String(v).toLowerCase() === "true" || String(v) === "1";
}

function resolveRole(q = {}, uniqueId = "") {
  const uid = String(uniqueId || "").toLowerCase();

  // ✅ regla definitiva
  if (BROADCASTER_LOGIN && uid === BROADCASTER_LOGIN) return "broadcaster";

  const isBroadcaster = toBool(q.isBroadcaster);
  const isMod = toBool(q.isMod);
  const isVip = toBool(q.isVip);
  const isSub = toBool(q.isSub);

  if (isBroadcaster) return "broadcaster";
  if (isMod) return "moderator";
  if (isVip) return "vip";
  if (isSub) return "subscriber";
  return "viewer";
}

function normalizeRole(role) {
  const r = String(role || "viewer").toLowerCase();
  return ROLE_BLOCK[r] !== undefined ? r : "viewer";
}


module.exports = {
  ROLE_BLOCK,
  loadModCommands,
  saveModCommands,
  isAdmin,
  resolveRole,
  normalizeRole,
};
