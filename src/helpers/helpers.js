
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
  if (["broadcaster", "streamer"].includes(r)) return "broadcaster";
  if (["moderator", "mod"].includes(r)) return "moderator";
  if (["vip"].includes(r)) return "vip";
  if (["subscriber", "sub"].includes(r)) return "subscriber";
  return "viewer";
}


module.exports = {
  ROLE_BLOCK,
  isAdmin,
  resolveRole,
  normalizeRole,
};
