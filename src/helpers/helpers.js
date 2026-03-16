const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const configPath = path.join(dataDir, 'countdown-config.json');

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

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      title: 'TIEMPO DE COLA',
      showTitle: true,
      targetDate: null,
      targetTime: null,
      timeZone: 'America/Santiago',
      targetIso: null,
      isRunning: false,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
  }
}

function readConfig() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return {
      title: 'TIEMPO DE COLA',
      showTitle: true,
      targetDate: null,
      targetTime: null,
      timeZone: 'America/Santiago',
      targetIso: null,
      isRunning: false,
      updatedAt: new Date().toISOString()
    };
  }
}
function writeConfig(config) {
  ensureDataFile();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Convierte fecha/hora local de una zona horaria a ISO UTC.
 * dateStr: YYYY-MM-DD
 * timeStr: HH:mm
 * timeZone: ej. America/Santiago
 */
function zonedDateTimeToUtcIso(dateStr, timeStr, timeZone) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  // Creamos una fecha "base" UTC con esos componentes
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Obtenemos cómo se vería esa fecha en la zona indicada
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = formatter.formatToParts(utcGuess);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetMs = desiredUtc - asIfUtc;

  const realUtcDate = new Date(utcGuess.getTime() + offsetMs);
  return realUtcDate.toISOString();
}

function getRemainingSeconds(config) {
  if (!config.isRunning || !config.targetIso) return 0;

  const nowMs = Date.now();
  const endMs = new Date(config.targetIso).getTime();

  return Math.max(0, Math.floor((endMs - nowMs) / 1000));
}

function buildPublicState(config) {
  return {
    title: config.title || 'TIEMPO DE COLA',
    showTitle: Boolean(config.showTitle),
    targetDate: config.targetDate || null,
    targetTime: config.targetTime || null,
    timeZone: config.timeZone || 'America/Santiago',
    targetIso: config.targetIso || null,
    isRunning: Boolean(config.isRunning),
    remainingSeconds: getRemainingSeconds(config),
    updatedAt: config.updatedAt || null
  };
}




module.exports = {
  ROLE_BLOCK,
  isAdmin,
  resolveRole,
  normalizeRole,
  readConfig,
  writeConfig,
  buildPublicState,
  getRemainingSeconds,
  zonedDateTimeToUtcIso,
};
