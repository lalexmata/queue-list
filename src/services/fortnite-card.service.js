const path = require("path");
const fs = require("fs");
const opentype = require("opentype.js");
const sharp = require("sharp");

const BACKGROUND_PATH = path.join(__dirname, "..", "assets", "img", "fortnite-stats-background-v2.png");
const FONT_PATH = path.join(__dirname, "..", "assets", "fonts", "RobotoCondensed.ttf");
const fontBuffer = fs.readFileSync(FONT_PATH);
const font = opentype.parse(fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength));
const WIDTH = 1536;
const HEIGHT = 1024;
const PANELS = [
  { key: "solo", label: "SOLO", y: 195, accent: "#28d7ff", tops: [["TOP 10", "top10"], ["TOP 25", "top25"]] },
  { key: "duo", label: "DUOS", y: 350, accent: "#5cff84", tops: [["TOP 5", "top5"], ["TOP 12", "top12"]] },
  { key: "trio", label: "TRIOS", y: 507, accent: "#ffb11b", tops: [["TOP 3", "top3"], ["TOP 6", "top6"]] },
  { key: "squad", label: "SQUADS", y: 663, accent: "#b74cff", tops: [["TOP 3", "top3"], ["TOP 6", "top6"]] },
  { key: "ltm", label: "LTM", y: 819, accent: "#f4ed58", tops: [["TOP 10", "top10"], ["TOP 25", "top25"]] },
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
  return `${vectorText(label, x, y + 42, 15, "#9298b3", { bold: true })}
    ${vectorText(value, x, y + 79, 29, "#ffffff", { bold: true })}
    <rect x="${x}" y="${y + 91}" width="145" height="4" rx="2" fill="#202638"/>
    <rect x="${x}" y="${y + 91}" width="112" height="4" rx="2" fill="${accent}"/>`;
}

function renderPanel(panel, stats) {
  const { y, label, accent, tops } = panel;
  const leftX = 70;
  const metricsX = [354, 548, 742, 936, 1130, 1324];
  if (!stats) {
    return `${vectorText(label, leftX, y + 49, 31, accent, { bold: true })}
      ${vectorText("SIN DATOS DE LA API ACTUAL", 354, y + 81, 25, "#9298b3", { bold: true })}
      ${vectorText("Fortnite-API devuelve este modo vacío", 354, y + 111, 15, "#6f7690")}`;
  }
  return `${vectorText(label, leftX, y + 49, 31, accent, { bold: true })}
    ${vectorText(`${integer(stats.matches)} PARTIDAS`, 286, y + 48, 15, "#d7d9ef", { anchor: "end", bold: true })}
    ${vectorText(`${integer(Math.round(stats.minutesPlayed / 60))} HORAS`, leftX, y + 100, 17, "#ffffff", { bold: true })}
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
    ${vectorText(`PIXELBOT · ${period}`, 75, 91, 20, "#6fe8ff", { bold: true })}
    ${vectorText(shortText(stats.name, 28), 75, 146, 47, "#ffffff", { bold: true })}
    ${vectorText(level, 1455, 89, 20, "#d66bff", { anchor: "end", bold: true })}
    ${vectorText(`${integer(stats.wins)} VICTORIAS · ${integer(stats.kills)} ELIMINACIONES · ${decimal(stats.kd)} K/D`, 1455, 143, 19, "#d7d9ef", { anchor: "end", bold: true })}
    ${panels}
  </svg>`);
}

async function renderFortniteStatsCard(stats) {
  return sharp(BACKGROUND_PATH).resize(WIDTH, HEIGHT)
    .composite([{ input: buildOverlay(stats), top: 0, left: 0 }])
    .png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { renderFortniteStatsCard, buildOverlay };
