const express = require("express");
const { requireIntegrationKey } = require("../../middleware/integrationAuth");
const { getPlayerStats } = require("../../services/fortnite.service");
const { searchDiscordGuildMembers, getDiscordGuildMember } = require("../../discord/pixelbot");
const { searchCommunityProfiles, getCommunityProfile, updateCommunityProfile, addCommunityIdentity, updateCommunityIdentity } = require("../../services/community-profile.service");
const {
  getFortniteAccount, getBirthday, saveBirthday, listBirthdays,
  listGuildSettings,
  savePlatformBirthday, getPlatformBirthday, getBirthdayProfile, listPlatformBirthdaysByMonth,
} = require("../../services/pixelbot.service");

const router = express.Router();

function sendError(res, error) {
  const messages = {
    invalid_player_name: "Escribe un nombre válido de Epic.", fortnite_not_configured: "La API de Fortnite todavía no está configurada.",
    player_not_found: "No encontré ese jugador.", player_stats_private: "Las estadísticas de ese jugador son privadas.",
    fortnite_rate_limited: "Se alcanzó temporalmente el límite de consultas.", fortnite_unavailable: "Fortnite-API no está disponible en este momento.",
    invalid_birthday: "La fecha de cumpleaños no es válida.", invalid_birthday_query: "El mes o día consultado no es válido.",
    invalid_timezone: "La zona horaria no es válida.", invalid_birthday_platform: "La plataforma no es válida.",
    invalid_birthday_user: "El usuario de la plataforma no es válido.", birthday_community_required: "Discord requiere un communityId.",
    invalid_birthday_profile: "El profileId no es válido.", birthday_profile_not_found: "No existe el perfil de cumpleaños indicado.",
    invalid_community_profile: "El perfil de comunidad no es válido.", invalid_profile_search: "Escribe al menos dos caracteres para buscar.",
    invalid_community_identity: "La identidad indicada no es válida.", community_profile_not_found: "No existe ese perfil de comunidad.",
    community_identity_not_found: "La cuenta vinculada ya no existe en este perfil.",
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

router.put("/birthdays/platforms/:platform/users/:userId", async (req, res) => {
  try {
    const birthday = await savePlatformBirthday({
      ...req.body, platform: req.params.platform, userId: req.params.userId,
      communityId: req.body.communityId || req.query.communityId || "",
    });
    res.json({ ok: true, birthday, message: `🎂 Cumpleaños de ${birthday.displayName} guardado: ${birthday.day}/${birthday.month}.` });
  } catch (error) { sendError(res, error); }
});

router.get("/birthdays/platforms/:platform/users/:userId", async (req, res) => {
  try {
    const birthday = await getPlatformBirthday({
      platform: req.params.platform, userId: req.params.userId, communityId: req.query.communityId || "",
    });
    res.json({ ok: true, birthday, message: birthday
      ? `🎂 El cumpleaños de ${birthday.displayName} es el ${birthday.day}/${birthday.month}.`
      : `${req.params.userId} no tiene un cumpleaños registrado.` });
  } catch (error) { sendError(res, error); }
});

router.get("/birthdays/platforms/:platform", async (req, res) => {
  try {
    const timeZone = String(req.query.timezone || "America/Santiago");
    const today = localDateParts(timeZone);
    const month = req.query.month === undefined ? today.month : Number(req.query.month);
    const scope = String(req.query.scope || "upcoming").toLowerCase();
    if (!["upcoming", "month"].includes(scope)) throw Object.assign(new Error("invalid_birthday_query"), { status: 400 });
    const upcoming = scope === "upcoming" && month === today.month;
    const birthdays = await listPlatformBirthdaysByMonth({
      platform: req.params.platform, communityId: req.query.communityId || "",
      month, fromDay: upcoming ? today.day : 1,
    });
    res.json({ ok: true, month, scope, count: birthdays.length, birthdays,
      message: platformBirthdayMessage(birthdays, month, upcoming) });
  } catch (error) { sendError(res, error); }
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
    res.json({ ok: true, birthday, message: birthday ? `Cumpleaños: ${birthday.day}/${birthday.month}.` : "No hay cumpleaños registrado." });
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
