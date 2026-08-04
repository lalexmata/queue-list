const path = require("path");
const fs = require("fs");
const opentype = require("opentype.js");
const sharp = require("sharp");

const BACKGROUND_PATH = path.join(__dirname, "..", "assets", "img", "fortnite-stats-background-v3.png");
const FONT_PATH = path.join(__dirname, "..", "assets", "fonts", "RobotoCondensed.ttf");
const fontBuffer = fs.readFileSync(FONT_PATH);
const font = opentype.parse(fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength));
const WIDTH = 1586;
const HEIGHT = 992;
const PANELS = [
  { key: "solo", label: "SOLO", y: 203, accent: "#28d7ff", tops: [["TOP 10", "top10"], ["TOP 25", "top25"]] },
  { key: "duo", label: "DUOS", y: 412, accent: "#5cff52", tops: [["TOP 5", "top5"], ["TOP 12", "top12"]] },
  { key: "squad", label: "SQUADS", y: 623, accent: "#b74cff", tops: [["TOP 3", "top3"], ["TOP 6", "top6"]] },
  { key: "ltm", label: "LTM", y: 811, accent: "#ffe52b", tops: [["TOP 10", "top10"], ["TOP 25", "top25"]] },
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

function metric(label, value, x, y, accent) {
  return `${vectorText(label, x, y + 50, 18, "#d7d9e8", { bold: true })}
    ${vectorText(value, x, y + 92, 34, "#ffffff", { bold: true })}
    <rect x="${x}" y="${y + 112}" width="148" height="6" rx="3" fill="#293044"/>
    <rect x="${x}" y="${y + 112}" width="104" height="6" rx="3" fill="${accent}"/>`;
}

function renderPanel(panel, stats) {
  const { y, label, accent, tops } = panel;
  const leftX = 75;
  const metricsX = [394, 592, 790, 995, 1187, 1364];
  if (!stats) {
    return `${vectorText(label, leftX, y + 53, 40, accent, { bold: true })}
      ${vectorText("SIN DATOS DISPONIBLES", 394, y + 85, 25, "#d7d9e8", { bold: true })}`;
  }
  return `${vectorText(label, leftX, y + 53, 40, accent, { bold: true })}
    ${vectorText(`${integer(stats.matches)} PARTIDAS`, leftX, y + 94, 20, "#ffffff", { bold: true })}
    ${vectorText(`${integer(Math.round(stats.minutesPlayed / 60))} HORAS`, leftX, y + 130, 19, "#ffffff", { bold: true })}
    ${metric("VICTORIAS", integer(stats.wins), metricsX[0], y, accent)}
    ${metric("WIN RATE", `${decimal(stats.winRate)}%`, metricsX[1], y, accent)}
    ${metric("ELIMINACIONES", integer(stats.kills), metricsX[2], y, accent)}
    ${metric("K/D", decimal(stats.kd), metricsX[3], y, accent)}
    ${metric(tops[0][0], integer(stats[tops[0][1]]), metricsX[4], y, accent)}
    ${metric(tops[1][0], integer(stats[tops[1][1]]), metricsX[5], y, accent)}`;
}

function buildOverlay(stats) {
  const period = stats.timeWindow === "season" ? "TEMPORADA ACTUAL" : "HISTÓRICO";
  const level = stats.battlePassLevel > 0 ? `NIVEL ${integer(stats.battlePassLevel)}` : "";
  const panels = PANELS.map(panel => renderPanel(panel, stats.modes?.[panel.key])).join("\n");
  return Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${vectorText(`PIXELBOT · ${period}`, 76, 78, 24, "#6fe8ff", { bold: true })}
    ${vectorText(shortText(stats.name, 28), 76, 145, 52, "#ffffff", { bold: true })}
    ${vectorText(level, 1495, 130, 38, "#ffffff", { anchor: "end", bold: true })}
    ${vectorText(`${integer(stats.wins)} VICTORIAS · ${integer(stats.kills)} ELIMINACIONES · ${decimal(stats.kd)} K/D`, 1170, 135, 22, "#ffffff", { anchor: "end", bold: true })}
    ${panels}
  </svg>`);
}

async function renderFortniteStatsCard(stats) {
  return sharp(BACKGROUND_PATH).resize(WIDTH, HEIGHT)
    .composite([{ input: buildOverlay(stats), top: 0, left: 0 }])
    .png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { renderFortniteStatsCard, buildOverlay };
