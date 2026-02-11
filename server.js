require("dotenv").config({quiet: true});
const { createApp } = require("./src/app");

process.on("unhandledRejection", (err) => console.error("❌ UnhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("❌ UncaughtException:", err));

const PORT = Number(process.env.PORT || 5005);
const HOST = "0.0.0.0"; // ✅ IMPORTANTE en Railway 

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
