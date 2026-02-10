const path = require("path");
const fs = require("fs");

const MOD_COMMANDS_PATH = path.join(__dirname, "data", "mod_commands.json");
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // ponla en Railway Variables
const BROADCASTER_LOGIN = (process.env.BROADCASTER_LOGIN || "lalexmata").toLowerCase();
// Orden de prioridad (0 = más alto)
const ROLE_RANK = {
  broadcaster: 0,
  moderator: 1,
  vip: 2,
  subscriber: 3,
  viewer: 4
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
  if (uid && uid === BROADCASTER_LOGIN) return "broadcaster";

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
  if (!role) return "viewer";
  const r = String(role).toLowerCase();

  if (ROLE_RANK[r] !== undefined) return r;
  return "viewer";
}

function insertByPriority(queue, userObj) {
  const r = userObj.role || "viewer";
  const myRank = ROLE_RANK[r] ?? 4;

  // Inserta al final del grupo de su mismo rank (estable)
  let insertAt = 0;
  for (let i = 0; i < queue.length; i++) {
    const ir = queue[i]?.role || "viewer";
    const iRank = ROLE_RANK[ir] ?? 4;

    if (iRank <= myRank) insertAt = i + 1; // seguimos pasando por ranks más altos o iguales
    else break; // encontró alguien de rank inferior => aquí se corta
  }

  queue.splice(insertAt, 0, userObj);
  return insertAt;
}

module.exports = {
  loadModCommands,
  saveModCommands,
  isAdmin,
  resolveRole,
  insertByPriority
};
