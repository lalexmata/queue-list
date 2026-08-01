const FORTNITE_STATS_URL = "https://fortnite-api.com/v2/stats/br/v2";

function fail(code, status = 400, details = {}) {
  return Object.assign(new Error(code), { status, ...details });
}

function cleanPlayerName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 100) throw fail("invalid_player_name");
  return name;
}

function getSkillVerdict(stats) {
  const kd = Number(stats.kd || 0);
  const winRate = Number(stats.winRate || 0);
  const killsPerMatch = Number(stats.killsPerMatch || 0);
  const score = kd * 35 + winRate * 2 + killsPerMatch * 15;
  if (score >= 180) return "Ese aim no vino de fábrica: aquí hay muchas horas de práctica.";
  if (score >= 100) return "Jugador peligroso: mejor no regalarle la altura.";
  if (score >= 50) return "Va por buen camino; ya sabe construir más que una caja.";
  return "Todavía está calentando motores. Cada partida suma experiencia.";
}

async function getPlayerStats(rawName, rawTimeWindow = "lifetime") {
  const apiKey = process.env.FORTNITE_API_KEY;
  if (!apiKey) throw fail("fortnite_not_configured", 503);
  const name = cleanPlayerName(rawName);
  const timeWindow = rawTimeWindow === "season" ? "season" : "lifetime";
  const params = new URLSearchParams({ name, accountType: "epic", timeWindow });
  let response;
  try {
    response = await fetch(`${FORTNITE_STATS_URL}?${params}`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw fail("fortnite_unavailable", 502, { cause: error });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status === 404 ? 404 : response.status === 403 ? 403 : 502;
    const code = response.status === 404 ? "player_not_found"
      : response.status === 403 ? "player_stats_private"
        : response.status === 429 ? "fortnite_rate_limited" : "fortnite_api_error";
    throw fail(code, status, { apiStatus: response.status, detail: body.error });
  }
  const overall = body.data?.stats?.all?.overall;
  if (!overall) throw fail("player_stats_unavailable", 404);
  const stats = {
    accountId: body.data?.account?.id || null,
    name: body.data?.account?.name || name,
    battlePassLevel: Number(body.data?.battlePass?.level || 0),
    wins: Number(overall.wins || 0), kills: Number(overall.kills || 0),
    deaths: Number(overall.deaths || 0), kd: Number(overall.kd || 0),
    matches: Number(overall.matches || 0), winRate: Number(overall.winRate || 0),
    killsPerMatch: Number(overall.killsPerMatch || 0),
    minutesPlayed: Number(overall.minutesPlayed || 0), timeWindow,
  };
  return { ...stats, verdict: getSkillVerdict(stats) };
}

module.exports = { getPlayerStats, getSkillVerdict };
