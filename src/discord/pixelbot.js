const { Client, Events, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getPlayerStats } = require("../services/fortnite.service");
const { findParticipantByUsername, getActiveGiveawayId } = require("../services/giveawayCoupons.service");
const { getLatestGiveawayWithWinners } = require("../services/giveawayRounds.service");
const {
  ensureGuild, getGuildSettings, updateGuildSettings, linkFortniteAccount, getFortniteAccount,
  saveBirthday, getBirthday, listBirthdays, listBirthdayGuilds,
  claimBirthdayAnnouncements, releaseBirthdayAnnouncement,
  linkCouponAccount, getCouponAccount, getDiscordUsersForTwitch,
} = require("../services/pixelbot.service");

let client;
const mentionCooldowns = new Map();

function errorMessage(error) {
  return ({ player_not_found: "No encontré ese jugador de Epic.", player_stats_private: "Las estadísticas de ese jugador son privadas.",
    account_not_linked: "Primero usa `/fortnite vincular`.", fortnite_not_configured: "Falta configurar FORTNITE_API_KEY.",
    invalid_birthday: "Esa fecha no es válida.", invalid_twitch_username: "Escribe un usuario válido de Twitch.",
    coupon_account_not_linked: "Primero usa `/cupones vincular` con tu usuario de Twitch.",
    no_active_giveaway: "En este momento no hay un sorteo activo." })[error.message] || "No pude completar la solicitud en este momento.";
}

async function allowed(interaction) {
  const settings = await getGuildSettings(interaction.guildId);
  if (settings?.allowedChannelId && settings.allowedChannelId !== interaction.channelId) {
    await interaction.reply({ content: `PixelBot está habilitado en <#${settings.allowedChannelId}>.`, ephemeral: true });
    return false;
  }
  return true;
}

async function handleFortnite(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "vincular") {
    await interaction.deferReply({ ephemeral: true });
    const stats = await getPlayerStats(interaction.options.getString("jugador", true));
    await linkFortniteAccount({ guildId: interaction.guildId, discordUserId: interaction.user.id, epicName: stats.name, epicAccountId: stats.accountId });
    return interaction.editReply(`Cuenta vinculada correctamente con **${stats.name}**.`);
  }
  await interaction.deferReply();
  const suppliedName = interaction.options.getString("jugador");
  const linked = suppliedName ? null : await getFortniteAccount(interaction.guildId, interaction.user.id);
  if (!suppliedName && !linked) throw Object.assign(new Error("account_not_linked"), { status: 404 });
  const stats = await getPlayerStats(suppliedName || linked.epicName, interaction.options.getString("periodo"));
  const embed = new EmbedBuilder().setColor(0x7c3aed).setTitle(`📊 Estadísticas de ${stats.name}`)
    .addFields(
      { name: "Victorias", value: String(stats.wins), inline: true }, { name: "Eliminaciones", value: String(stats.kills), inline: true },
      { name: "K/D", value: stats.kd.toFixed(2), inline: true }, { name: "Partidas", value: String(stats.matches), inline: true },
      { name: "Win rate", value: `${stats.winRate.toFixed(2)}%`, inline: true }, { name: "Kills/partida", value: stats.killsPerMatch.toFixed(2), inline: true },
      { name: "El juicio de PixelBot", value: `*${stats.verdict}*` }
    ).setFooter({ text: stats.timeWindow === "season" ? "Temporada actual" : "Histórico" });
  return interaction.editReply({ embeds: [embed] });
}

async function handleBirthday(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "registrar") {
    const birthday = await saveBirthday({ guildId: interaction.guildId, discordUserId: interaction.user.id,
      day: interaction.options.getInteger("dia", true), month: interaction.options.getInteger("mes", true), year: interaction.options.getInteger("ano") });
    return interaction.reply({ content: `Guardé tu cumpleaños: **${birthday.day}/${birthday.month}**.`, ephemeral: true });
  }
  if (sub === "lista") {
    const birthdays = await listBirthdays(interaction.guildId);
    if (!birthdays.length) return interaction.reply("Todavía no hay cumpleaños registrados en este servidor.");
    const visible = birthdays.slice(0, 50);
    const lines = visible.map(item => `🎂 ${String(item.day).padStart(2, "0")}/${String(item.month).padStart(2, "0")} — <@${item.discordUserId}>`);
    if (birthdays.length > visible.length) lines.push(`\n…y ${birthdays.length - visible.length} cumpleaños más.`);
    const embed = new EmbedBuilder().setColor(0xf472b6).setTitle("🎉 Cumpleaños del servidor")
      .setDescription(lines.join("\n")).setFooter({ text: `${birthdays.length} cumpleaños registrado(s)` });
    return interaction.reply({ embeds: [embed] });
  }
  const birthday = await getBirthday(interaction.guildId, interaction.user.id);
  return interaction.reply({ content: birthday ? `Tu cumpleaños registrado es **${birthday.day}/${birthday.month}**.` : "No tienes un cumpleaños registrado.", ephemeral: true });
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
  const settings = await getGuildSettings(interaction.guildId);
  return interaction.reply({ content: `Canal: ${settings?.allowedChannelId ? `<#${settings.allowedChannelId}>` : "todos"}\nCanal de cumpleaños: ${settings?.birthdayChannelId ? `<#${settings.birthdayChannelId}>` : "usa el canal general"}\nZona horaria: ${settings?.timezone || "America/Santiago"}`, ephemeral: true });
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
      const claimed = await claimBirthdayAnnouncements({ guildId: settings.guildId, ...date });
      if (!claimed.users.length) continue;
      for (const user of claimed.users) {
        try {
          await channel.send(`🎉 ¡Feliz cumpleaños <@${user.discordUserId}>! Que tengas un día increíble, lleno de buenas partidas y muchas victorias. 🎂🥳`);
        } catch (error) {
          await releaseBirthdayAnnouncement(settings.guildId, user.discordUserId, claimed.date);
          console.error(`PixelBot birthday message error (${user.discordUserId}):`, error);
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
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { console.log("ℹ️ PixelBot disabled: DISCORD_BOT_TOKEN is not configured"); return null; }
  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  client.once(Events.ClientReady, async ready => {
    console.log(`✅ PixelBot connected as ${ready.user.tag}`);
    await announceBirthdays();
    setInterval(() => announceBirthdays().catch(console.error), 15 * 60 * 1000).unref();
  });
  client.on(Events.GuildCreate, guild => ensureGuild({ guildId: guild.id, guildName: guild.name }).catch(console.error));
  client.on(Events.MessageCreate, message => handleMention(message).catch(error => {
    console.error("PixelBot mention error:", error);
  }));
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || !interaction.guildId) return;
    try {
      await ensureGuild({ guildId: interaction.guildId, guildName: interaction.guild?.name });
      if (interaction.commandName !== "pixelbot" && !await allowed(interaction)) return;
      if (interaction.commandName === "fortnite") await handleFortnite(interaction);
      if (interaction.commandName === "cumpleanos") await handleBirthday(interaction);
      if (interaction.commandName === "cupones") await handleCoupons(interaction);
      if (interaction.commandName === "sorteo") await handleGiveaway(interaction);
      if (interaction.commandName === "pixelbot") await handleConfig(interaction);
    } catch (error) {
      console.error("PixelBot command error:", error);
      const payload = { content: errorMessage(error), ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.reply(payload);
    }
  });
  await client.login(token);
  return client;
}

module.exports = { startPixelBot };
