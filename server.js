require("dotenv").config({ quiet: true });

process.on("uncaughtException", (e) => console.error("UNCAUGHT", e));
process.on("unhandledRejection", (e) => console.error("UNHANDLED", e));

let createApp;
try {
  ({ createApp } = require("./src/app"));
} catch (e) {
  console.error("BOOT ERROR requiring ./src/app:", e);
  process.exit(1);
}

const PORT = Number(process.env.PORT || 8080);

let app;
try {
  app = createApp();
} catch (e) {
  console.error("BOOT ERROR creating app:", e);
  process.exit(1);
}

app.listen(PORT, () => console.log("Listening on", PORT));
