const { Client, Events, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getPlayerStats } = require("../services/fortnite.service");
const { renderFortniteStatsCard } = require("../services/fortnite-card.service");
const { findParticipantByUsername, getActiveGiveawayId } = require("../services/giveawayCoupons.service");
const { getLatestGiveawayWithWinners } = require("../services/giveawayRounds.service");
const { cleanMessage, claimDueMessages, finishScheduledMessage } = require("../services/pixelbot-messages.service");
const {
  ensureGuild, getGuildSettings, updateGuildSettings, linkFortniteAccount, getFortniteAccount,
  saveBirthday, getBirthday, listBirthdays, listBirthdayGuilds,
  listDiscordIdentitiesNeedingNames, updateDiscordIdentityName,
  claimBirthdayAnnouncements, releaseBirthdayAnnouncement,
  linkCouponAccount, getCouponAccount, getDiscordUsersForTwitch,
} = require("../services/pixelbot.service");

let client;
const mentionCooldowns = new Map();

function pixelBotEnabled() {
  return !["0", "false", "no", "off"].includes(String(process.env.PIXELBOT_ENABLED ?? "true").trim().toLowerCase());
}

function getPixelBotStatus() {
  return {
    enabled: pixelBotEnabled(),
    tokenConfigured: Boolean(process.env.DISCORD_BOT_TOKEN),
    started: Boolean(client),
    ready: Boolean(client?.isReady()),
    username: client?.user?.tag || null,
    guildCount: client?.guilds?.cache?.size || 0,
  };
}

function commandContext(interaction, error) {
  let subcommand = null;
  try { subcommand = interaction.options?.getSubcommand(false) || null; } catch { /* no subcommand */ }
  return {
    event: "pixelbot_command_error",
    interactionId: interaction.id,
    command: interaction.commandName,
    subcommand,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    deferred: interaction.deferred,
    replied: interaction.replied,
    errorName: error?.name,
    errorMessage: error?.message,
    errorCode: error?.code,
    status: error?.status,
    stack: error?.stack,
  };
}

function errorMessage(error) {
  return ({ player_not_found: "No encontré ese jugador de Epic.", player_stats_private: "Las estadísticas de ese jugador son privadas.",
    account_not_linked: "Primero usa `/fortnite vincular`.", fortnite_not_configured: "Falta configurar FORTNITE_API_KEY.",
    fortnite_unavailable: "La API de Fortnite no está respondiendo. Inténtalo nuevamente en unos minutos.",
    fortnite_api_error: "La API de Fortnite devolvió un error temporal. Inténtalo nuevamente en unos minutos.",
    fortnite_rate_limited: "La API de Fortnite alcanzó temporalmente su límite de consultas.",
    invalid_birthday: "Esa fecha no es válida.", invalid_twitch_username: "Escribe un usuario válido de Twitch.",
    coupon_account_not_linked: "Primero usa `/cupones vincular` con tu usuario de Twitch.",
    no_active_giveaway: "En este momento no hay un sorteo activo." })[error.message] || "No pude completar la solicitud en este momento.";
}

async function allowed(interaction) {
  const settings = await getGuildSettings(interaction.guildId);
  if (settings?.allowedChannelId && settings.allowedChannelId !== interaction.channelId) {
    const payload = { content: `PixelBot está habilitado en <#${settings.allowedChannelId}>.`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: payload.content }); else await interaction.reply(payload);
    return false;
  }
  return true;
}

async function handleFortnite(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "vincular") {
    const stats = await getPlayerStats(interaction.options.getString("jugador", true));
    await linkFortniteAccount({ guildId: interaction.guildId, discordUserId: interaction.user.id, epicName: stats.name, epicAccountId: stats.accountId });
    return interaction.editReply(`Cuenta vinculada correctamente con **${stats.name}**.`);
  }
  const suppliedName = interaction.options.getString("jugador");
  const linked = suppliedName ? null : await getFortniteAccount(interaction.guildId, interaction.user.id);
  if (!suppliedName && !linked) throw Object.assign(new Error("account_not_linked"), { status: 404 });
  const stats = await getPlayerStats(suppliedName || linked.epicName, interaction.options.getString("periodo"));
  try {
    const card = await renderFortniteStatsCard(stats);
    const safeName = String(stats.name).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 50) || "stats";
    return interaction.editReply({
      content: `**El juicio de PixelBot:** *${stats.verdict}*`,
      files: [{ attachment: card, name: `fortnite-${safeName}.png` }],
    });
  } catch (error) {
    console.error("PixelBot Fortnite card render error:", error);
    const embed = new EmbedBuilder().setColor(0x7c3aed).setTitle(`📊 Estadísticas de ${stats.name}`)
      .addFields(
        { name: "Victorias", value: String(stats.wins), inline: true },
        { name: "Eliminaciones", value: String(stats.kills), inline: true },
        { name: "K/D", value: stats.kd.toFixed(2), inline: true },
        { name: "Partidas", value: String(stats.matches), inline: true },
        { name: "Win rate", value: `${stats.winRate.toFixed(2)}%`, inline: true },
        { name: "El juicio de PixelBot", value: `*${stats.verdict}*` }
      ).setFooter({ text: stats.timeWindow === "season" ? "Temporada actual" : "Histórico" });
    return interaction.editReply({ embeds: [embed] });
  }
}

async function handleBirthday(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "registrar") {
    const birthday = await saveBirthday({ guildId: interaction.guildId, discordUserId: interaction.user.id,
      displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      day: interaction.options.getInteger("dia", true), month: interaction.options.getInteger("mes", true), year: interaction.options.getInteger("ano") });
    return interaction.editReply({ content: `Guardé tu cumpleaños: **${birthday.day}/${birthday.month}**.` });
  }
  if (sub === "lista") {
    const birthdays = await listBirthdays(interaction.guildId);
    if (!birthdays.length) return interaction.editReply("Todavía no hay cumpleaños registrados en este servidor.");
    const visible = birthdays.slice(0, 50);
    const lines = visible.map(item => {
      const identity = item.discordUserId
        ? `<@${item.discordUserId}>`
        : `**${item.displayName || item.identityName || "Usuario"}**${item.platform ? ` · ${item.platform}` : ""}`;
      return `🎂 ${String(item.day).padStart(2, "0")}/${String(item.month).padStart(2, "0")} — ${identity}`;
    });
    if (birthdays.length > visible.length) lines.push(`\n…y ${birthdays.length - visible.length} cumpleaños más.`);
    const embed = new EmbedBuilder().setColor(0xf472b6).setTitle("🎉 Cumpleaños del servidor")
      .setDescription(lines.join("\n")).setFooter({ text: `${birthdays.length} cumpleaños registrado(s)` });
    return interaction.editReply({ embeds: [embed] });
  }
  const birthday = await getBirthday(interaction.guildId, interaction.user.id);
  const hasBirthday = birthday?.day != null && birthday?.month != null;
  return interaction.editReply({ content: hasBirthday
    ? `Tu cumpleaños registrado es **${birthday.day}/${birthday.month}**.`
    : "No tienes un cumpleaños registrado. Puedes guardarlo ahora con `/cumpleanos registrar`." });
}

async function syncDiscordIdentityNames() {
  const identities = await listDiscordIdentitiesNeedingNames();
  for (const identity of identities) {
    try {
      const guild = client.guilds.cache.get(identity.guildId) || await client.guilds.fetch(identity.guildId);
      const member = await guild.members.fetch(identity.discordUserId);
      await updateDiscordIdentityName({
        ...identity, displayName: member.displayName || member.user.globalName || member.user.username,
      });
    } catch (error) {
      console.warn(`PixelBot could not resolve Discord name (${identity.guildId}:${identity.discordUserId}):`, error.message);
    }
  }
}

async function searchDiscordGuildMembers(guildId, query, limit = 25) {
  const term = String(query || "").trim();
  if (term.length < 2) throw Object.assign(new Error("invalid_discord_member_search"), { status: 400 });
  if (!client?.isReady()) throw Object.assign(new Error("pixelbot_not_connected"), { status: 503 });

  const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
  const members = await guild.members.fetch({ query: term, limit: Math.min(Math.max(Number(limit) || 25, 1), 50) });
  return [...members.values()]
    .filter(member => !member.user.bot)
    .map(member => ({
      userId: member.id,
      username: member.user.username,
      globalName: member.user.globalName || null,
      displayName: member.displayName || member.user.globalName || member.user.username,
      avatarUrl: member.displayAvatarURL({ size: 64 }),
      guildId: guild.id,
      guildName: guild.name,
    }));
}

async function getDiscordGuildMember(guildId, userId) {
  if (!client?.isReady()) throw Object.assign(new Error("pixelbot_not_connected"), { status: 503 });
  const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
  const member = await guild.members.fetch(String(userId));
  return {
    userId: member.id,
    username: member.user.username,
    displayName: member.displayName || member.user.globalName || member.user.username,
    avatarUrl: member.displayAvatarURL({ size: 256 }),
    guildId: guild.id,
    guildName: guild.name,
  };
}

async function listPixelBotChannels(guildId) {
  if (!client?.isReady()) throw Object.assign(new Error("pixelbot_not_connected"), { status: 503 });
  const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
  const channels = await guild.channels.fetch();
  return [...channels.values()].filter(channel => {
    if (!channel?.isTextBased() || channel.isThread()) return false;
    const permissions = channel.permissionsFor(client.user);
    return permissions?.has(PermissionFlagsBits.ViewChannel) && permissions?.has(PermissionFlagsBits.SendMessages);
  }).map(channel => ({ channelId: channel.id, channelName: channel.name, position: channel.rawPosition || 0 }))
    .sort((a, b) => a.position - b.position || a.channelName.localeCompare(b.channelName));
}

async function sendPixelBotMessage({ guildId, channelId, content }) {
  if (!client?.isReady()) throw Object.assign(new Error("pixelbot_not_connected"), { status: 503 });
  const channel = await client.channels.fetch(String(channelId));
  if (!channel?.isTextBased() || channel.guildId !== String(guildId) || !channel.isSendable()) {
    throw Object.assign(new Error("invalid_pixelbot_channel"), { status: 400 });
  }
  const message = await channel.send({ content: cleanMessage(content), allowedMentions: { parse: [] } });
  return { messageId: message.id, channelId: channel.id, sentAt: message.createdAt };
}

async function sendWelcomeTest({ guildId, channelId }) {
  if (!client?.isReady()) throw Object.assign(new Error("pixelbot_not_connected"), { status: 503 });
  const channel = await client.channels.fetch(String(channelId));
  if (!channel?.isTextBased() || channel.guildId !== String(guildId) || !channel.isSendable()) {
    throw Object.assign(new Error("invalid_pixelbot_channel"), { status: 400 });
  }
  const embed = new EmbedBuilder().setColor(0x22d3ee).setTitle("Prueba de bienvenida de PixelBot")
    .setDescription("Si puedes ver este mensaje, PixelBot tiene permiso para escribir en este canal.")
    .setFooter({ text: "Mensaje de prueba · no corresponde a un ingreso real" }).setTimestamp();
  const message = await channel.send({ embeds: [embed] });
  return { messageId: message.id, channelId: channel.id, sentAt: message.createdAt };
}

async function processScheduledMessages() {
  if (!client?.isReady()) return;
  const messages = await claimDueMessages();
  for (const message of messages) {
    try {
      await sendPixelBotMessage(message);
      await finishScheduledMessage(message.id);
    } catch (error) {
      await finishScheduledMessage(message.id, error);
      console.error(JSON.stringify({ event: "pixelbot_scheduled_message_error", id: message.id, error: error.message }));
    }
  }
}

async function handleCoupons(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "vincular") {
    const account = await linkCouponAccount({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
      twitchUsername: interaction.options.getString("usuario", true),
    });
    return interaction.reply({ content: `Vinculé tu cuenta con **${account.twitchUsername}** en Twitch.`, ephemeral: true });
  }

  const guildSettings = await getGuildSettings(interaction.guildId);
  if (!guildSettings?.giveawayActive) return interaction.reply("En este momento no hay un sorteo activo en este servidor.");
  await getActiveGiveawayId();
  const supplied = interaction.options.getString("usuario");
  const linked = supplied ? null : await getCouponAccount(interaction.guildId, interaction.user.id);
  if (!supplied && !linked) throw Object.assign(new Error("coupon_account_not_linked"), { status: 404 });
  const username = supplied || linked.twitchUsername;
  const participant = await findParticipantByUsername(username, "twitch");
  const count = Number(participant?.couponCount || 0);
  return interaction.reply(count
    ? `🎟️ **${participant.displayName}** tiene **${count} cupón${count === 1 ? "" : "es"}** para el sorteo.`
    : `😢 **@${String(username).replace(/^@+/, "")}** no tiene cupones para el sorteo.`);
}

async function handleGiveaway(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "estado") {
    const settings = await getGuildSettings(interaction.guildId);
    if (!settings?.giveawayActive) return interaction.reply("En este momento no hay un sorteo activo en este servidor.");
    try {
      await getActiveGiveawayId();
      return interaction.reply("🎉 Hay un sorteo activo en este servidor.");
    } catch (error) {
      if (error.message === "no_active_giveaway") return interaction.reply("En este momento no hay un sorteo activo.");
      throw error;
    }
  }
  if (sub === "ganadores") {
    await interaction.deferReply();
    const giveaway = await getLatestGiveawayWithWinners();
    if (!giveaway) return interaction.editReply("Todavía no hay ganadores registrados.");
    const twitchNames = giveaway.winners.filter(winner => winner.platform === "twitch").map(winner => winner.username);
    const discordUsers = await getDiscordUsersForTwitch(interaction.guildId, twitchNames);
    const lines = giveaway.winners.map(winner => {
      const discordUserId = winner.platform === "twitch" ? discordUsers.get(String(winner.username).toLowerCase()) : null;
      const identity = discordUserId ? `<@${discordUserId}>` : `**${winner.displayName}**`;
      return `🏆 **#${winner.position}** ${identity} · @${winner.username} en ${winner.platform}`;
    });
    const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle(`🏆 Ganadores · ${giveaway.name}`)
      .setDescription(lines.join("\n"))
      .setFooter({ text: giveaway.drawAt ? `Sorteo: ${new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(new Date(giveaway.drawAt))}` : "Último sorteo" });
    return interaction.editReply({ embeds: [embed] });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: "Necesitas el permiso Gestionar servidor.", ephemeral: true });
  }
  const active = sub === "activar";
  if (active) await getActiveGiveawayId();
  await updateGuildSettings(interaction.guildId, { giveawayActive: active });
  return interaction.reply(active ? "🎉 Sorteo activado. Ya se pueden consultar cupones." : "El sorteo fue cerrado.");
}

async function handleConfig(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "Necesitas el permiso Gestionar servidor.", ephemeral: true });
  if (interaction.options.getSubcommand() === "canal") {
    const channel = interaction.options.getChannel("canal", true);
    await updateGuildSettings(interaction.guildId, { allowedChannelId: channel.id });
    return interaction.reply({ content: `PixelBot quedó configurado para ${channel}.`, ephemeral: true });
  }
  if (interaction.options.getSubcommand() === "canal-cumpleanos") {
    const channel = interaction.options.getChannel("canal", true);
    await updateGuildSettings(interaction.guildId, { birthdayChannelId: channel.id });
    return interaction.reply({ content: `Las felicitaciones se publicarán en ${channel}.`, ephemeral: true });
  }
  if (interaction.options.getSubcommand() === "canal-bienvenida") {
    const channel = interaction.options.getChannel("canal", true);
    await updateGuildSettings(interaction.guildId, { welcomeChannelId: channel.id });
    return interaction.reply({ content: `Las bienvenidas y despedidas se publicarán en ${channel}.`, ephemeral: true });
  }
  if (interaction.options.getSubcommand() === "servidor-cumpleanos-default") {
    const active = interaction.options.getBoolean("activo", true);
    await updateGuildSettings(interaction.guildId, { isDefaultBirthdayGuild: active });
    return interaction.reply({ content: active
      ? "Este servidor recibirá los cumpleaños de perfiles sin servidor asignado."
      : "Este servidor dejó de ser el destino predeterminado de cumpleaños.", ephemeral: true });
  }
  const settings = await getGuildSettings(interaction.guildId);
  return interaction.reply({ content: `Canal: ${settings?.allowedChannelId ? `<#${settings.allowedChannelId}>` : "todos"}\nCanal de cumpleaños: ${settings?.birthdayChannelId ? `<#${settings.birthdayChannelId}>` : "usa el canal general"}\nServidor predeterminado de cumpleaños: ${settings?.isDefaultBirthdayGuild ? "sí" : "no"}\nCanal de bienvenida: ${settings?.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : "sin configurar"}\nZona horaria: ${settings?.timezone || "America/Santiago"}`, ephemeral: true });
}

async function announceMemberChange(member, joined) {
  if (member.user?.bot) return;
  const settings = await getGuildSettings(member.guild.id);
  if (!settings?.welcomeChannelId) return;
  const channel = await member.guild.channels.fetch(settings.welcomeChannelId);
  if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("welcome_channel_not_sendable");
  const canEmbed = channel.permissionsFor(member.guild.members.me)?.has(PermissionFlagsBits.EmbedLinks) === true;

  if (joined) {
    const embed = new EmbedBuilder()
      .setColor(0x22d3ee)
      .setTitle("¡Bienvenido al servidor!")
      .setDescription(`Esperamos que disfrutes la comunidad, <@${member.id}>.`)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: `Ya somos ${member.guild.memberCount} miembros` })
      .setTimestamp();
    const payload = canEmbed
      ? { content: `<@${member.id}>`, embeds: [embed], allowedMentions: { users: [member.id] } }
      : { content: `¡Bienvenido al servidor, <@${member.id}>! Esperamos que disfrutes la comunidad.`, allowedMentions: { users: [member.id] } };
    await channel.send(payload);
    return;
  }

  const displayName = String(member.displayName || member.user?.globalName || member.user?.username || "Un miembro")
    .replace(/([\\*_~|>`])/g, "\\$1");
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Un miembro dejó el servidor")
    .setDescription(`**${displayName}** se ha despedido de la comunidad.`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${member.guild.memberCount} miembros en el servidor` })
    .setTimestamp();
  await channel.send(canEmbed ? { embeds: [embed] } : { content: `**${displayName}** dejó el servidor.` });
}

function localDateParts(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

async function announceBirthdays() {
  if (!client?.isReady()) return;
  const guilds = await listBirthdayGuilds();
  for (const settings of guilds) {
    try {
      const date = localDateParts(settings.timezone);
      const channel = await client.channels.fetch(settings.channelId);
      if (!channel?.isTextBased()) throw new Error("birthday_channel_not_text");
      const claimed = await claimBirthdayAnnouncements({ guildId: settings.guildId, ...date,
        isDefaultBirthdayGuild: settings.isDefaultBirthdayGuild });
      if (!claimed.users.length) continue;
      for (const user of claimed.users) {
        try {
          const recipient = user.discordUserId ? `<@${user.discordUserId}>` : `**${user.displayName}**`;
          await channel.send({
            content: `🎉 ¡Feliz cumpleaños ${recipient}! Que tengas un día increíble, lleno de buenas partidas y muchas victorias. 🎂🥳`,
            allowedMentions: user.discordUserId ? { users: [user.discordUserId] } : { parse: [] },
          });
        } catch (error) {
          await releaseBirthdayAnnouncement(settings.guildId, user.announcementKey, claimed.date);
          console.error(`PixelBot birthday message error (${user.announcementKey}):`, error);
        }
      }
    } catch (error) {
      console.error(`PixelBot birthday announcement error (${settings.guildId}):`, error);
    }
  }
}

async function handleMention(message) {
  if (!client?.user || !message.guildId || message.author.bot || !message.mentions.has(client.user)) return;
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  if (now - (mentionCooldowns.get(key) || 0) < 10_000) return;
  mentionCooldowns.set(key, now);

  const settings = await getGuildSettings(message.guildId);
  if (settings?.allowedChannelId && settings.allowedChannelId !== message.channelId) {
    await message.reply(`¡Hola! Estoy disponible en <#${settings.allowedChannelId}>. 👾`);
    return;
  }

  await message.reply([
    `¡Hola ${message.author}! Soy **PixelBot** 👾`,
    "Puedes usar `/fortnite stats`, `/cupones consultar` o `/cumpleanos lista`.",
    "Escribe `/` y selecciona PixelBot para ver todas mis opciones.",
  ].join("\n"));
}

async function startPixelBot() {
  if (client) return client;
  const enabled = pixelBotEnabled();
  if (!enabled) {
    console.log("ℹ️ PixelBot disabled by PIXELBOT_ENABLED");
    return null;
  }
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { console.log("ℹ️ PixelBot disabled: DISCORD_BOT_TOKEN is not configured"); return null; }
  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] });
  client.on(Events.Error, error => console.error(JSON.stringify({
    event: "pixelbot_client_error", errorMessage: error?.message, errorCode: error?.code, stack: error?.stack,
  })));
  client.on(Events.ShardError, error => console.error(JSON.stringify({
    event: "pixelbot_shard_error", errorMessage: error?.message, errorCode: error?.code, stack: error?.stack,
  })));
  client.on(Events.Invalidated, () => console.error(JSON.stringify({ event: "pixelbot_session_invalidated" })));
  client.once(Events.ClientReady, async ready => {
    console.log(`✅ PixelBot connected as ${ready.user.tag}`);
    await syncDiscordIdentityNames();
    await announceBirthdays();
    await processScheduledMessages();
    setInterval(() => announceBirthdays().catch(console.error), 15 * 60 * 1000).unref();
    setInterval(() => processScheduledMessages().catch(error => console.error(JSON.stringify({ event: "pixelbot_scheduler_error", error: error.message }))), 30 * 1000).unref();
  });
  client.on(Events.GuildCreate, guild => ensureGuild({ guildId: guild.id, guildName: guild.name }).catch(console.error));
  client.on(Events.GuildMemberAdd, member => announceMemberChange(member, true).catch(error => {
    console.error(`PixelBot welcome message error (${member.guild.id}:${member.id}):`, error);
  }));
  client.on(Events.GuildMemberRemove, member => announceMemberChange(member, false).catch(error => {
    console.error(`PixelBot farewell message error (${member.guild.id}:${member.id}):`, error);
  }));
  client.on(Events.MessageCreate, message => handleMention(message).catch(error => {
    console.error("PixelBot mention error:", error);
  }));
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || !interaction.guildId) return;
    try {
      if (interaction.commandName === "fortnite") {
        await interaction.deferReply({ ephemeral: interaction.options.getSubcommand() === "vincular" });
      }
      if (interaction.commandName === "cumpleanos") {
        await interaction.deferReply({ ephemeral: interaction.options.getSubcommand() !== "lista" });
      }
      await ensureGuild({ guildId: interaction.guildId, guildName: interaction.guild?.name });
      await updateDiscordIdentityName({
        guildId: interaction.guildId, discordUserId: interaction.user.id,
        displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      });
      if (interaction.commandName !== "pixelbot" && !await allowed(interaction)) return;
      if (interaction.commandName === "fortnite") await handleFortnite(interaction);
      if (interaction.commandName === "cumpleanos") await handleBirthday(interaction);
      if (interaction.commandName === "cupones") await handleCoupons(interaction);
      if (interaction.commandName === "sorteo") await handleGiveaway(interaction);
      if (interaction.commandName === "pixelbot") await handleConfig(interaction);
    } catch (error) {
      if (error.code === 40060) {
        console.error(JSON.stringify({ ...commandContext(interaction, error), diagnosis: "duplicate_acknowledgement_check_multiple_bot_instances" }));
        return;
      }
      console.error(JSON.stringify(commandContext(interaction, error)));
      const reference = String(interaction.id || "unknown").slice(-8);
      const payload = { content: `${errorMessage(error)} Referencia: \`${reference}\`.`, ephemeral: true };
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: payload.content }); else await interaction.reply(payload);
      } catch (replyError) {
        console.error(JSON.stringify({ ...commandContext(interaction, replyError), event: "pixelbot_error_response_failed", originalError: error?.message }));
      }
    }
  });
  await client.login(token);
  return client;
}

module.exports = { startPixelBot, getPixelBotStatus, searchDiscordGuildMembers, getDiscordGuildMember,
  listPixelBotChannels, sendPixelBotMessage, sendWelcomeTest };
