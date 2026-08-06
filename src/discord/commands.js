const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

const commands = [
  new SlashCommandBuilder().setName("fortnite").setDescription("Consulta o vincula estadísticas de Fortnite")
    .addSubcommand(sub => sub.setName("stats").setDescription("Muestra estadísticas")
      .addStringOption(opt => opt.setName("jugador").setDescription("Nombre de Epic; omítelo para usar tu cuenta vinculada"))
      .addStringOption(opt => opt.setName("periodo").setDescription("Periodo de las estadísticas").addChoices(
        { name: "Histórico", value: "lifetime" }, { name: "Temporada", value: "season" }
      )))
    .addSubcommand(sub => sub.setName("vincular").setDescription("Vincula tu cuenta de Epic")
      .addStringOption(opt => opt.setName("jugador").setDescription("Nombre exacto de Epic").setRequired(true))),
  new SlashCommandBuilder().setName("cumpleanos").setDescription("Gestiona cumpleaños")
    .addSubcommand(sub => sub.setName("registrar").setDescription("Guarda tu cumpleaños")
      .addIntegerOption(opt => opt.setName("dia").setDescription("Día").setMinValue(1).setMaxValue(31).setRequired(true))
      .addIntegerOption(opt => opt.setName("mes").setDescription("Mes").setMinValue(1).setMaxValue(12).setRequired(true))
      .addIntegerOption(opt => opt.setName("ano").setDescription("Año opcional y privado").setMinValue(1900).setMaxValue(2100)))
    .addSubcommand(sub => sub.setName("consultar").setDescription("Consulta tu cumpleaños registrado"))
    .addSubcommand(sub => sub.setName("lista").setDescription("Muestra los cumpleaños del servidor")),
  new SlashCommandBuilder().setName("cupones").setDescription("Consulta los cupones del sorteo de Twitch")
    .addSubcommand(sub => sub.setName("vincular").setDescription("Vincula tu usuario de Twitch")
      .addStringOption(opt => opt.setName("usuario").setDescription("Tu nombre de usuario en Twitch").setRequired(true)))
    .addSubcommand(sub => sub.setName("consultar").setDescription("Consulta tus cupones o los de otro usuario")
      .addStringOption(opt => opt.setName("usuario").setDescription("Usuario de Twitch; omítelo para usar tu cuenta vinculada"))),
  new SlashCommandBuilder().setName("sorteo").setDescription("Consulta o administra el sorteo")
    .addSubcommand(sub => sub.setName("estado").setDescription("Indica si hay un sorteo activo"))
    .addSubcommand(sub => sub.setName("ganadores").setDescription("Menciona los ganadores del último sorteo"))
    .addSubcommand(sub => sub.setName("activar").setDescription("Activa el sorteo (requiere Gestionar servidor)"))
    .addSubcommand(sub => sub.setName("desactivar").setDescription("Cierra el sorteo (requiere Gestionar servidor)")),
  new SlashCommandBuilder().setName("pixelbot").setDescription("Configura PixelBot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(sub => sub.setName("canal").setDescription("Establece el canal permitido")
      .addChannelOption(opt => opt.setName("canal").setDescription("Canal para comandos").setRequired(true)))
    .addSubcommand(sub => sub.setName("canal-cumpleanos").setDescription("Establece el canal de felicitaciones")
      .addChannelOption(opt => opt.setName("canal").setDescription("Canal para felicitar cumpleaños").setRequired(true)))
    .addSubcommand(sub => sub.setName("canal-bienvenida").setDescription("Establece el canal de entradas y salidas")
      .addChannelOption(opt => opt.setName("canal").setDescription("Canal para mensajes de bienvenida y despedida")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand(sub => sub.setName("servidor-cumpleanos-default").setDescription("Recibe cumpleaños sin servidor asignado")
      .addBooleanOption(opt => opt.setName("activo").setDescription("Activar este servidor como predeterminado").setRequired(true)))
    .addSubcommand(sub => sub.setName("estado").setDescription("Muestra la configuración del servidor")),
].map(command => command.toJSON());

module.exports = { commands };
