require("dotenv").config({ quiet: true });
const { createApp } = require("./src/app");

const PORT = Number(process.env.PORT || 8080);

const app = createApp();
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});