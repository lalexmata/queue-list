const express = require("express");
const { requireIntegrationKey } = require("../../middleware/integrationAuth");
const { getPlayerStats } = require("../../services/fortnite.service");
const { getPixelBotStatus, searchDiscordGuildMembers, getDiscordGuildMember } = require("../../discord/pixelbot");
const { createCommunityProfile, searchCommunityProfiles, listRecentCommunityActivity, getCommunityProfile, updateCommunityProfile, addCommunityIdentity, updateCommunityIdentity, deleteCommunityIdentity, mergeCommunityProfiles } = require("../../services/community-profile.service");
const {
  getFortniteAccount, getBirthday, saveBirthday, listBirthdays,
  listGuildSettings,
  savePlatformBirthday, getPlatformBirthday, getBirthdayProfile, listPlatformBirthdaysByMonth, parseBirthdayMonth,
} = require("../../services/pixelbot.service");

const router = express.Router();

router.get("/status", (_req, res) => res.json({ ok: true, pixelbot: getPixelBotStatus() }));

function sendError(res, error) {
  const messages = {
    invalid_player_name: "Escribe un nombre válido de Epic.", fortnite_not_configured: "La API de Fortnite todavía no está configurada.",
    player_not_found: "No encontré ese jugador.", player_stats_private: "Las estadísticas de ese jugador son privadas.",
    fortnite_rate_limited: "Se alcanzó temporalmente el límite de consultas.", fortnite_unavailable: "Fortnite-API no está disponible en este momento.",
    fortnite_api_error: "Fortnite-API devolvió un error temporal. Inténtalo nuevamente en unos minutos.",
    invalid_birthday: "La fecha de cumpleaños no es válida.", invalid_birthday_query: "El mes o día consultado no es válido.",
    invalid_timezone: "La zona horaria no es válida.", invalid_birthday_platform: "La plataforma no es válida.",
    invalid_birthday_user: "El usuario de la plataforma no es válido.", birthday_community_required: "Discord requiere un communityId.",
    invalid_birthday_profile: "El profileId no es válido.", birthday_profile_not_found: "No existe el perfil de cumpleaños indicado.",
    invalid_community_profile: "El perfil de comunidad no es válido.", invalid_profile_search: "Escribe al menos dos caracteres para buscar.",
    invalid_community_identity: "La identidad indicada no es válida.", community_profile_not_found: "No existe ese perfil de comunidad.",
    community_identity_not_found: "La cuenta vinculada ya no existe en este perfil.",
    last_community_identity: "El perfil debe conservar al menos una cuenta vinculada.",
    same_community_profile: "Selecciona otro perfil para realizar la unificación.",
    invalid_discord_member_search: "Escribe al menos dos caracteres para buscar en Discord.",
    pixelbot_not_connected: "PixelBot no está conectado. Actívalo en este servidor para consultar sus miembros.",
    account_not_linked: "El usuario no tiene una cuenta de Fortnite vinculada.",
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

router.get("/community/profiles", async (req, res) => {
  try {
    const profiles = await searchCommunityProfiles(req.query.q, req.query.limit);
    res.json({ ok: true, count: profiles.length, profiles });
  } catch (error) { sendError(res, error); }
});

router.get("/community/recent-activity", async (req, res) => {
  try {
    const activity = await listRecentCommunityActivity(req.query.limit);
    res.json({ ok: true, count: activity.length, activity });
  } catch (error) { sendError(res, error); }
});

router.post("/community/profiles", async (req, res) => {
  try {
    const profile = await createCommunityProfile(req.body);
    res.status(201).json({ ok: true, profile });
  } catch (error) { sendError(res, error); }
});

router.get("/community/discord-guilds", async (_req, res) => {
  try {
    const guilds = await listGuildSettings();
    res.json({ ok: true, guilds });
  } catch (error) { sendError(res, error); }
});

router.get("/community/discord-guilds/:guildId/members", async (req, res) => {
  try {
    const members = await searchDiscordGuildMembers(req.params.guildId, req.query.q, req.query.limit);
    res.json({ ok: true, count: members.length, members });
  } catch (error) { sendError(res, error); }
});

router.get("/community/discord-guilds/:guildId/members/:userId", async (req, res) => {
  try {
    const member = await getDiscordGuildMember(req.params.guildId, req.params.userId);
    res.json({ ok: true, member });
  } catch (error) {
    if (error.code === 10007 || error.code === 10013) error.status = 404;
    sendError(res, error);
  }
});

router.get("/community/profiles/:profileId", async (req, res) => {
  try {
    const profile = await getCommunityProfile(req.params.profileId);
    res.status(profile ? 200 : 404).json({ ok: Boolean(profile), profile });
  } catch (error) { sendError(res, error); }
});

router.patch("/community/profiles/:profileId", async (req, res) => {
  try {
    const profile = await updateCommunityProfile(req.params.profileId, req.body);
    res.status(profile ? 200 : 404).json({ ok: Boolean(profile), profile });
  } catch (error) { sendError(res, error); }
});

router.post("/community/profiles/:profileId/merge", async (req, res) => {
  try {
    const profile = await mergeCommunityProfiles(req.params.profileId, req.body.sourceProfileId);
    res.json({ ok: true, profile });
  } catch (error) { sendError(res, error); }
});

router.post("/community/profiles/:profileId/identities", async (req, res) => {
  try {
    const profile = await addCommunityIdentity(req.params.profileId, req.body);
    res.json({ ok: true, profile });
  } catch (error) { sendError(res, error); }
});

router.patch("/community/profiles/:profileId/identities/:platform/:userId", async (req, res) => {
  try {
    const profile = await updateCommunityIdentity(req.params.profileId, {
      platform: req.params.platform, userId: req.params.userId, communityId: req.query.communityId || "",
    }, req.body);
    res.json({ ok: true, profile });
  } catch (error) { sendError(res, error); }
});

router.delete("/community/profiles/:profileId/identities/:platform/:userId", async (req, res) => {
  try {
    const profile = await deleteCommunityIdentity(req.params.profileId, {
      platform: req.params.platform, userId: req.params.userId, communityId: req.query.communityId || "",
    });
    res.json({ ok: true, profile });
  } catch (error) { sendError(res, error); }
});

function localDateParts(timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
  } catch {
    throw Object.assign(new Error("invalid_timezone"), { status: 400 });
  }
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function platformBirthdayMessage(birthdays, month, upcoming) {
  const monthName = new Intl.DateTimeFormat("es-CL", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2024, month - 1, 1)));
  const title = upcoming ? `Próximos cumpleaños de ${monthName}` : `Cumpleaños de ${monthName}`;
  if (!birthdays.length) return `🎂 No hay ${title.toLowerCase()} registrados.`;
  const entries = birthdays.map(item => `${String(item.day).padStart(2, "0")}/${String(item.month).padStart(2, "0")} ${item.displayName}`);
  let message = `🎂 ${title}: `;
  let included = 0;
  for (const entry of entries) {
    const separator = included ? " · " : "";
    if (`${message}${separator}${entry}`.length > 440) break;
    message += `${separator}${entry}`;
    included += 1;
  }
  if (included < entries.length) message += ` · y ${entries.length - included} más`;
  return message;
}

function sendBirthdayIntegrationError(res, error, usage) {
  const known = new Set([
    "invalid_birthday", "invalid_birthday_query", "invalid_birthday_platform",
    "invalid_birthday_user", "invalid_timezone", "birthday_community_required",
    "invalid_birthday_profile", "birthday_profile_not_found",
  ]);
  const code = known.has(error?.message) ? error.message : "birthday_request_failed";
  if (code === "birthday_request_failed") console.error("Birthday integration error:", error);
  const explanations = {
    invalid_birthday: "La fecha indicada no es válida.",
    invalid_birthday_query: "El mes debe ser un número entre 1 y 12.",
    invalid_birthday_platform: "La plataforma indicada no es válida.",
    invalid_birthday_user: "No pude identificar el usuario que ejecutó el comando.",
    invalid_timezone: "La zona horaria configurada no es válida.",
    birthday_community_required: "Falta indicar el servidor para una cuenta de Discord.",
    invalid_birthday_profile: "El perfil indicado no es válido.",
    birthday_profile_not_found: "No encontré el perfil indicado.",
    birthday_request_failed: "No pude procesar el cumpleaños en este momento.",
  };
  return res.json({ ok: false, status: "error", error: code, message: `${explanations[code]} ${usage}` });
}

router.put("/birthdays/platforms/:platform/users/:userId", async (req, res) => {
  try {
    const birthday = await savePlatformBirthday({
      ...req.body, platform: req.params.platform, userId: req.params.userId,
      communityId: req.body.communityId || req.query.communityId || "",
    });
    res.json({ ok: true, birthday, message: `🎂 Cumpleaños de ${birthday.displayName} guardado: ${birthday.day}/${birthday.month}.` });
  } catch (error) { sendBirthdayIntegrationError(res, error, "Uso correcto: !cumple DÍA MES. Ejemplo: !cumple 25 10 o !cumple 25 octubre."); }
});

// Atajo GET para Streamer.bot, cuya subacción Fetch URL no admite PUT.
router.get("/birthdays/platforms/:platform/users/:userId/register", async (req, res) => {
  try {
    const birthday = await savePlatformBirthday({
      platform: req.params.platform,
      userId: req.params.userId,
      displayName: req.query.displayName || req.params.userId,
      day: req.query.day,
      month: req.query.month,
      year: req.query.year || null,
      communityId: req.query.communityId || "",
      profileId: req.query.profileId || null,
    });
    res.json({ ok: true, birthday, message: `🎂 Cumpleaños de ${birthday.displayName} guardado: ${birthday.day}/${birthday.month}.` });
  } catch (error) { sendBirthdayIntegrationError(res, error, "Uso correcto: !cumple DÍA MES. Ejemplo: !cumple 25 10 o !cumple 25 octubre."); }
});

router.get("/birthdays/platforms/:platform/users/:userId", async (req, res) => {
  try {
    const birthday = await getPlatformBirthday({
      platform: req.params.platform, userId: req.params.userId, communityId: req.query.communityId || "",
    });
    const hasBirthday = birthday?.day != null && birthday?.month != null;
    res.json({ ok: true, birthday: hasBirthday ? birthday : null, message: hasBirthday
      ? `🎂 El cumpleaños de ${birthday.displayName} es el ${birthday.day}/${birthday.month}.`
      : `${req.params.userId} no tiene un cumpleaños registrado. Puede guardarlo con !cumple DÍA MES. Ejemplo: !cumple 25 octubre.` });
  } catch (error) { sendBirthdayIntegrationError(res, error, "Uso correcto: !micumple."); }
});

router.get("/birthdays/platforms/:platform", async (req, res) => {
  try {
    const timeZone = String(req.query.timezone || "America/Santiago");
    const today = localDateParts(timeZone);
    const month = req.query.month === undefined ? today.month : parseBirthdayMonth(req.query.month);
    const scope = String(req.query.scope || "upcoming").toLowerCase();
    if (!["upcoming", "month"].includes(scope)) throw Object.assign(new Error("invalid_birthday_query"), { status: 400 });
    const upcoming = scope === "upcoming" && month === today.month;
    const birthdays = await listPlatformBirthdaysByMonth({
      platform: req.params.platform, communityId: req.query.communityId || "",
      month, fromDay: upcoming ? today.day : 1,
    });
    res.json({ ok: true, month, scope, count: birthdays.length, birthdays,
      message: platformBirthdayMessage(birthdays, month, upcoming) });
  } catch (error) {
    const usage = String(req.query.scope || "upcoming").toLowerCase() === "month"
      ? "Uso correcto: !cumplesmes MES. Ejemplo: !cumplesmes 10 o !cumplesmes octubre."
      : "Uso correcto: !cumples.";
    sendBirthdayIntegrationError(res, error, usage);
  }
});

router.get("/birthdays/profiles/:profileId", async (req, res) => {
  try {
    const profile = await getBirthdayProfile(req.params.profileId);
    res.status(profile ? 200 : 404).json({ ok: Boolean(profile), profile,
      message: profile ? `Perfil con ${profile.identities.length} identidad(es).` : "No existe ese perfil de cumpleaños." });
  } catch (error) { sendError(res, error); }
});

router.get("/birthdays/:guildId/:discordUserId", requireIntegrationKey, async (req, res) => {
  try {
    const birthday = await getBirthday(req.params.guildId, req.params.discordUserId);
    const hasBirthday = birthday?.day != null && birthday?.month != null;
    res.json({ ok: true, birthday: hasBirthday ? birthday : null,
      message: hasBirthday ? `Cumpleaños: ${birthday.day}/${birthday.month}.`
        : "No hay cumpleaños registrado. Puede guardarlo con /cumpleanos registrar indicando el día y el mes." });
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
