require("dotenv").config({quiet: true});
const { createApp } = require("./src/app");

const PORT = process.env.PORT || 5005;
const HOST = "0.0.0.0"; // ✅ IMPORTANTE en Railway 

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
