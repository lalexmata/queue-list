const path = require("path");
const sharp = require("sharp");

const BACKGROUND_PATH = path.join(__dirname, "..", "assets", "img", "fortnite-stats-background.png");
const WIDTH = 1536;
const HEIGHT = 1024;
const PANELS = [
  { key: "solo", label: "SOLO", x: 146, y: 334, accent: "#28d7ff", tops: [["TOP 10", "top10"], ["TOP 25", "top25"]] },
  { key: "duo", label: "DUOS", x: 802, y: 334, accent: "#b74cff", tops: [["TOP 5", "top5"], ["TOP 12", "top12"]] },
  { key: "squad", label: "SQUADS", x: 146, y: 634, accent: "#28d7ff", tops: [["TOP 3", "top3"], ["TOP 6", "top6"]] },
  { key: "ltm", label: "LTM", x: 802, y: 634, accent: "#b74cff", tops: [["TOP 10", "top10"], ["TOP 25", "top25"]] },
];

function escapeXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function shortText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function integer(value) {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function decimal(value) {
  return Number(value || 0).toFixed(2);
}

function metric(label, value, x, y, color = "#ffffff") {
  return `<text x="${x}" y="${y}" class="metric-label">${escapeXml(label)}</text>
    <text x="${x}" y="${y + 35}" class="metric-value" fill="${color}">${escapeXml(value)}</text>`;
}

function renderPanel(panel, stats) {
  const { x, y, label, accent, tops } = panel;
  if (!stats) {
    return `<text x="${x}" y="${y + 30}" class="mode-title" fill="${accent}">${label}</text>
      <text x="${x}" y="${y + 112}" class="empty">Sin datos disponibles</text>`;
  }
  const columns = [x, x + 150, x + 300, x + 450];
  return `<text x="${x}" y="${y + 30}" class="mode-title" fill="${accent}">${label}</text>
    <text x="${x + 560}" y="${y + 28}" class="matches">${integer(stats.matches)} PARTIDAS</text>
    <line x1="${x}" y1="${y + 48}" x2="${x + 560}" y2="${y + 48}" stroke="${accent}" stroke-width="3" opacity=".8"/>
    ${metric("VICTORIAS", integer(stats.wins), columns[0], y + 82, accent)}
    ${metric("WIN RATE", `${decimal(stats.winRate)}%`, columns[1], y + 82)}
    ${metric("ELIMINACIONES", integer(stats.kills), columns[2], y + 82)}
    ${metric("K/D", decimal(stats.kd), columns[3], y + 82, accent)}
    ${metric(tops[0][0], integer(stats[tops[0][1]]), columns[0], y + 166)}
    ${metric(tops[1][0], integer(stats[tops[1][1]]), columns[1], y + 166)}
    ${metric("KILLS/PARTIDA", decimal(stats.killsPerMatch), columns[2], y + 166)}
    ${metric("TIEMPO", `${integer(Math.round(stats.minutesPlayed / 60))} h`, columns[3], y + 166)}`;
}

function buildOverlay(stats) {
  const period = stats.timeWindow === "season" ? "TEMPORADA ACTUAL" : "HISTÓRICO";
  const level = stats.battlePassLevel > 0 ? `NIVEL ${integer(stats.battlePassLevel)}` : "";
  const panels = PANELS.map(panel => renderPanel(panel, stats.modes?.[panel.key])).join("\n");
  return Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <style>
      text { font-family: Arial, Helvetica, sans-serif; }
      .eyebrow { fill: #6fe8ff; font-size: 22px; font-weight: 700; letter-spacing: 4px; }
      .player { fill: #fff; font-size: 54px; font-weight: 900; letter-spacing: 1px; }
      .summary { fill: #d7d9ef; font-size: 20px; font-weight: 700; }
      .mode-title { font-size: 31px; font-weight: 900; letter-spacing: 2px; }
      .matches { fill: #b9bdd3; font-size: 16px; font-weight: 700; text-anchor: end; }
      .metric-label { fill: #9298b3; font-size: 14px; font-weight: 700; }
      .metric-value { font-size: 27px; font-weight: 900; }
      .empty { fill: #9298b3; font-size: 23px; font-weight: 700; }
    </style>
    <text x="154" y="112" class="eyebrow">PIXELBOT · ${period}</text>
    <text x="154" y="174" class="player">${escapeXml(shortText(stats.name, 28))}</text>
    <text x="1375" y="111" class="eyebrow" text-anchor="end">${level}</text>
    <text x="1375" y="168" class="summary" text-anchor="end">${integer(stats.wins)} VICTORIAS · ${integer(stats.kills)} ELIMINACIONES · ${decimal(stats.kd)} K/D</text>
    ${panels}
  </svg>`);
}

async function renderFortniteStatsCard(stats) {
  return sharp(BACKGROUND_PATH).resize(WIDTH, HEIGHT)
    .composite([{ input: buildOverlay(stats), top: 0, left: 0 }])
    .png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { renderFortniteStatsCard, buildOverlay };
