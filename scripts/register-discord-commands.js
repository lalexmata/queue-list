require("dotenv").config();

const { REST, Routes } = require("discord.js");
const { commands } = require("../src/discord/commands");

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) throw new Error("Faltan DISCORD_BOT_TOKEN o DISCORD_CLIENT_ID");

  const rest = new REST({ version: "10" }).setToken(token);
  const result = await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`Comandos de Discord registrados: ${result.map(command => command.name).join(", ")}`);
}

main().catch(error => {
  console.error(`No se pudieron registrar los comandos: ${error.message}`);
  process.exit(1);
});
