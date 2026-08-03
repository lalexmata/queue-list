const path = require("path");
const fs = require("fs");
const opentype = require("opentype.js");
const sharp = require("sharp");

const BACKGROUND_PATH = path.join(__dirname, "..", "assets", "img", "fortnite-stats-background.png");
const FONT_PATH = path.join(__dirname, "..", "assets", "fonts", "RobotoCondensed.ttf");
const fontBuffer = fs.readFileSync(FONT_PATH);
const font = opentype.parse(fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength));
const WIDTH = 1536;
const HEIGHT = 1024;
const PANELS = [
  { key: "solo", label: "SOLO", x: 146, y: 334, accent: "#28d7ff", tops: [["TOP 10", "top10"], ["TOP 25", "top25"]] },
  { key: "duo", label: "DUOS", x: 802, y: 334, accent: "#b74cff", tops: [["TOP 5", "top5"], ["TOP 12", "top12"]] },
  { key: "squad", label: "SQUADS", x: 146, y: 634, accent: "#28d7ff", tops: [["TOP 3", "top3"], ["TOP 6", "top6"]] },
  { key: "ltm", label: "LTM", x: 802, y: 634, accent: "#b74cff", tops: [["TOP 10", "top10"], ["TOP 25", "top25"]] },
];

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

function vectorText(value, x, y, size, fill, options = {}) {
  const text = String(value ?? "");
  const scale = size / font.unitsPerEm;
  const glyphs = Array.from(text, character => font.charToGlyph(character));
  const width = glyphs.reduce((total, glyph) => total + glyph.advanceWidth * scale, 0);
  const startX = options.anchor === "end" ? x - width : x;
  let cursor = startX;
  const pathData = glyphs.map(glyph => {
    const data = glyph.getPath(cursor, y, size).toPathData(2);
    cursor += glyph.advanceWidth * scale;
    return data;
  }).join("");
  const stroke = options.bold ? ` stroke="${fill}" stroke-width="${Math.max(0.5, size / 45)}"` : "";
  return `<path d="${pathData}" fill="${fill}"${stroke}/>`;
}

function metric(label, value, x, y, color = "#ffffff") {
  return `${vectorText(label, x, y, 14, "#9298b3", { bold: true })}
    ${vectorText(value, x, y + 35, 27, color, { bold: true })}`;
}

function renderPanel(panel, stats) {
  const { x, y, label, accent, tops } = panel;
  if (!stats) {
    return `${vectorText(label, x, y + 30, 31, accent, { bold: true })}
      ${vectorText("Sin datos disponibles", x, y + 112, 23, "#9298b3", { bold: true })}`;
  }
  const columns = [x, x + 150, x + 300, x + 450];
  return `${vectorText(label, x, y + 30, 31, accent, { bold: true })}
    ${vectorText(`${integer(stats.matches)} PARTIDAS`, x + 560, y + 28, 16, "#b9bdd3", { anchor: "end", bold: true })}
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
    ${vectorText(`PIXELBOT · ${period}`, 154, 112, 22, "#6fe8ff", { bold: true })}
    ${vectorText(shortText(stats.name, 28), 154, 174, 54, "#ffffff", { bold: true })}
    ${vectorText(level, 1375, 111, 22, "#6fe8ff", { anchor: "end", bold: true })}
    ${vectorText(`${integer(stats.wins)} VICTORIAS · ${integer(stats.kills)} ELIMINACIONES · ${decimal(stats.kd)} K/D`, 1375, 168, 20, "#d7d9ef", { anchor: "end", bold: true })}
    ${panels}
  </svg>`);
}

async function renderFortniteStatsCard(stats) {
  return sharp(BACKGROUND_PATH).resize(WIDTH, HEIGHT)
    .composite([{ input: buildOverlay(stats), top: 0, left: 0 }])
    .png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { renderFortniteStatsCard, buildOverlay };
