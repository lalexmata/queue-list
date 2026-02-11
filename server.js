require("dotenv").config({ quiet: true });

console.log("ENV CHECK:", {
  PORT: process.env.PORT,
  HAS_DATABASE_URL: !!process.env.DATABASE_URL,
  HAS_BROADCASTER_LOGIN: !!process.env.BROADCASTER_LOGIN,
});

process.on("uncaughtException", (e) => {
  console.error("UNCAUGHT EXCEPTION:", e);
});
process.on("unhandledRejection", (e) => {
  console.error("UNHANDLED REJECTION:", e);
});

const { createApp } = require("./src/app");

const PORT = process.env.PORT || 5005;
const HOST = "0.0.0.0";

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
