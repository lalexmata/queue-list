const express = require("express");

const app = express();

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("Listening on", PORT);
});