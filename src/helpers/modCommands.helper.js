const fs = require("fs");
const path = require("path");

const MOD_COMMANDS_PATH = path.join(__dirname, "..", "data", "mod_commands.json");

function ensureFile() {
  if (!fs.existsSync(path.dirname(MOD_COMMANDS_PATH))) {
    fs.mkdirSync(path.dirname(MOD_COMMANDS_PATH), { recursive: true });
  }
  if (!fs.existsSync(MOD_COMMANDS_PATH)) {
    fs.writeFileSync(MOD_COMMANDS_PATH, "[]", "utf8");
  }
}

function loadModCommands() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(MOD_COMMANDS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveModCommands(list) {
  ensureFile();
  fs.writeFileSync(
    MOD_COMMANDS_PATH,
    JSON.stringify(list, null, 2),
    "utf8"
  );
}

function addModCommand(command, description) {
  const list = loadModCommands();

  const normalized = command.startsWith("!") ? command : "!" + command;

  if (list.some(c => c.command.toLowerCase() === normalized.toLowerCase())) {
    return { status: "exists" };
  }

  const item = {
    command: normalized,
    description,
    createdAt: new Date().toISOString(),
  };

  list.unshift(item);
  saveModCommands(list);

  return { status: "added", item };
}

function deleteModCommand(command) {
  const normalized = command.startsWith("!") ? command : "!" + command;
  const list = loadModCommands();
  const next = list.filter(
    c => c.command.toLowerCase() !== normalized.toLowerCase()
  );
  saveModCommands(next);
}

module.exports = {
  loadModCommands,
  addModCommand,
  deleteModCommand,
};
