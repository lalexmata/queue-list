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
const { 
  resolveRole, 
  readConfig, 
  writeConfig, 
  buildPublicState,
  zonedDateTimeToUtcIso, 
  getRemainingSeconds 
} = require("../../helpers/helpers");

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
  try {
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

    const result = await upsertByPriority({
      uniqueId: String(uniqueId),
      nickname: String(nickname || uniqueId),
      role,
      platform: String(platform),
    });

    const queue = await getQueue();
    const pos = queue.findIndex(
      user => user.uniqueId.toLowerCase() === String(uniqueId).toLowerCase()
    ) + 1;
    const added = result.added;
    const chatName = String(nickname || uniqueId).replace(/^@+/, "");
    res.json({
      ok: true,
      status: added ? "added" : "already_in_queue",
      added,
      alreadyInQueue: !added,
      shouldPlayVoice: added,
      refund: !added,
      pos,
      size: queue.length,
      message: added
        ? `@${chatName} te agregué a la lista. Estás en la posición ${pos}.`
        : `@${chatName} ya estás en la lista, espera tu turno. Estás en la posición ${pos}.`,
    });
  } catch (e) {
    console.error("❌ Error en /api/jugar:", e);
    return res.status(500).json({ ok: false, error: "db_error", message: e.message, detail: e.detail || e.toString() });
  }
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

//API DE CONTADOR

router.get('/countdown/config', (req, res) => {
  const config = readConfig();
  return res.json({
    ok: true,
    config: buildPublicState(config)
  });
});

router.post('/countdown/config', (req, res) => {
  try {
    const current = readConfig();

    const title =
      typeof req.body.title === 'string'
        ? req.body.title.trim()
        : current.title;

    const showTitle =
      typeof req.body.showTitle === 'boolean'
        ? req.body.showTitle
        : current.showTitle;

    const targetDate =
      typeof req.body.targetDate === 'string'
        ? req.body.targetDate
        : current.targetDate;

    const targetTime =
      typeof req.body.targetTime === 'string'
        ? req.body.targetTime
        : current.targetTime;

    const timeZone =
      typeof req.body.timeZone === 'string' && req.body.timeZone.trim()
        ? req.body.timeZone.trim()
        : current.timeZone || 'America/Santiago';

    const autoStart =
      typeof req.body.autoStart === 'boolean'
        ? req.body.autoStart
        : true;

    let targetIso = current.targetIso;

    if (targetDate && targetTime) {
      targetIso = zonedDateTimeToUtcIso(targetDate, targetTime, timeZone);
    }

    const nextConfig = {
      ...current,
      title,
      showTitle,
      targetDate,
      targetTime,
      timeZone,
      targetIso,
      isRunning: autoStart && Boolean(targetIso),
      updatedAt: new Date().toISOString()
    };

    writeConfig(nextConfig);

    return res.json({
      ok: true,
      message: 'Configuración guardada correctamente',
      config: buildPublicState(nextConfig)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'No se pudo guardar la configuración'
    });
  }
});

router.post('/countdown/start', (req, res) => {
  try {
    const current = readConfig();
    console.log("Iniciando contador con config:", current);
    if (!current.targetIso) {
      return res.status(400).json({
        ok: false,
        message: 'Debes configurar una fecha y hora objetivo'
      });
    }

    const nextConfig = {
      ...current,
      isRunning: true,
      updatedAt: new Date().toISOString()
    };

    writeConfig(nextConfig);

    return res.json({
      ok: true,
      message: 'Contador iniciado',
      config: buildPublicState(nextConfig)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'No se pudo iniciar el contador'
    });
  }
});

router.post('/countdown/stop', (req, res) => {
  try {
    const current = readConfig();

    const nextConfig = {
      ...current,
      isRunning: false,
      updatedAt: new Date().toISOString()
    };

    writeConfig(nextConfig);

    return res.json({
      ok: true,
      message: 'Contador detenido',
      config: buildPublicState(nextConfig)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'No se pudo detener el contador'
    });
  }
});

router.post('/countdown/reset', (req, res) => {
  try {
    const current = readConfig();
    const now = new Date();

    const nextConfig = {
      ...current,
      isRunning: false,
      startedAt: null,
      endAt: null,
      pausedRemainingSeconds: Number(current.durationSeconds || 0),
      updatedAt: now.toISOString()
    };

    writeConfig(nextConfig);

    return res.json({
      ok: true,
      message: 'Contador reiniciado',
      config: buildPublicState(nextConfig)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'No se pudo reiniciar el contador'
    });
  }
});

router.post('/countdown/add-seconds', (req, res) => {
  try {
    const current = readConfig();
    const now = new Date();

    const secondsToAdd = Number(req.body.seconds);

    if (!Number.isFinite(secondsToAdd)) {
      return res.status(400).json({
        ok: false,
        message: 'El valor seconds es inválido'
      });
    }

    let nextConfig = { ...current };

    if (current.isRunning && current.endAt) {
      const currentEndMs = new Date(current.endAt).getTime();
      const nextEndMs = currentEndMs + secondsToAdd * 1000;

      nextConfig = {
        ...nextConfig,
        endAt: new Date(nextEndMs).toISOString(),
        updatedAt: now.toISOString()
      };
    } else {
      const currentPaused = Number(current.pausedRemainingSeconds || 0);
      nextConfig = {
        ...nextConfig,
        pausedRemainingSeconds: Math.max(0, currentPaused + secondsToAdd),
        durationSeconds: Math.max(
          0,
          Number(current.durationSeconds || 0) + secondsToAdd
        ),
        updatedAt: now.toISOString()
      };
    }

    writeConfig(nextConfig);

    return res.json({
      ok: true,
      message: 'Tiempo actualizado',
      config: buildPublicState(nextConfig)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'No se pudo modificar el tiempo'
    });
  }
});

// ===== Twitch OAuth (Bot) =====
// Requiere Node 18+ (fetch global). Si usas Node 16, avísame y lo adapto con axios.
const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

function getBaseUrl(req) {
  // Preferimos PUBLIC_BASE_URL para prod (Railway), y fallback al host detectado
  const envBase = process.env.PUBLIC_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString();
  const host = (req.headers["x-forwarded-host"] || req.get("host")).toString();
  return `${proto}://${host}`;
}

function buildRedirectUri(req) {
  return `${getBaseUrl(req)}/api/auth/twitch/callback`;
}

// Guardamos state en memoria (simple). Si reinicia el server, se pierde (ok para setup).
const oauthStateStore = new Map(); // state -> createdAt

router.get("/auth/twitch", (req, res) => {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) return res.status(500).json({ ok: false, error: "Missing TWITCH_CLIENT_ID" });

  const redirectUri = buildRedirectUri(req);
  const scopes = (process.env.TWITCH_SCOPES || "chat:read chat:edit").trim();

  // state anti-CSRF
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  oauthStateStore.set(state, Date.now());

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    force_verify: "true", // fuerza el consentimiento (útil cuando cambias scopes)
  });

  // Redirige al login/consent de Twitch
  res.redirect(`${TWITCH_AUTH_URL}?${params.toString()}`);
});

router.get("/auth/twitch/callback", async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.status(400).send(`OAuth error: ${error} - ${error_description || ""}`);
    }
    if (!code) return res.status(400).send("Missing ?code");
    if (!state || !oauthStateStore.has(state)) {
      return res.status(400).send("Invalid state (state mismatch). Reintenta /api/auth/twitch");
    }

    oauthStateStore.delete(state);

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).json({ ok: false, error: "Missing TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET" });
    }

    const redirectUri = buildRedirectUri(req);

    // Intercambio code -> token
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const tokenResp = await fetch(`${TWITCH_TOKEN_URL}?${tokenParams.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const tokenJson = await tokenResp.json();

    if (!tokenResp.ok) {
      return res.status(400).json({ ok: false, error: "token_exchange_failed", detail: tokenJson });
    }

    // tokenJson trae: access_token, refresh_token, expires_in, scope, token_type
    // ⚠️ Importante: guarda refresh_token en Railway Variables o en DB, NO en código.
    // Por ahora lo mostramos para que lo copies.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`
      <h2>✅ Twitch OAuth OK</h2>
      <p><b>Guarda esto en Railway/ENV:</b></p>
      <pre style="background:#111;color:#0f0;padding:12px;border-radius:8px;white-space:pre-wrap;">
TWITCH_BOT_ACCESS_TOKEN=${tokenJson.access_token}
TWITCH_BOT_REFRESH_TOKEN=${tokenJson.refresh_token}
      </pre>
      <p>Scopes: ${Array.isArray(tokenJson.scope) ? tokenJson.scope.join(" ") : String(tokenJson.scope || "")}</p>
      <p>Expira en: ${tokenJson.expires_in}s</p>
    `);
  } catch (e) {
    console.error("OAuth callback error:", e);
    res.status(500).json({ ok: false, error: "oauth_callback_failed", detail: e?.message || String(e) });
  }
});




router.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

module.exports = router;
