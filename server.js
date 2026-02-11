require("dotenv").config();
const { createApp } = require("./src/app");

const PORT = process.env.PORT || 5005;

const app = createApp();
app.listen(PORT, () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
