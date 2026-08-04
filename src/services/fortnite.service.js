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

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function normalizeModeStats(rawStats) {
  if (!rawStats) return null;
  return {
    wins: number(rawStats.wins), kills: number(rawStats.kills), deaths: number(rawStats.deaths),
    kd: number(rawStats.kd), matches: number(rawStats.matches), winRate: number(rawStats.winRate),
    killsPerMatch: number(rawStats.killsPerMatch), minutesPlayed: number(rawStats.minutesPlayed),
    top3: number(rawStats.top3), top5: number(rawStats.top5), top6: number(rawStats.top6),
    top10: number(rawStats.top10), top12: number(rawStats.top12), top25: number(rawStats.top25),
  };
}

function normalizeStatsPayload(data, fallbackName, timeWindow) {
  const allStats = data?.stats?.all || {};
  const overall = normalizeModeStats(allStats.overall);
  if (!overall) throw fail("player_stats_unavailable", 404);
  const stats = {
    accountId: data?.account?.id || null,
    name: data?.account?.name || fallbackName,
    battlePassLevel: number(data?.battlePass?.level),
    ...overall,
    timeWindow,
    modes: {
      solo: normalizeModeStats(allStats.solo),
      duo: normalizeModeStats(allStats.duo),
      trio: normalizeModeStats(allStats.trio),
      squad: normalizeModeStats(allStats.squad),
      ltm: normalizeModeStats(allStats.ltm),
    },
  };
  return { ...stats, verdict: getSkillVerdict(stats) };
}

async function getPlayerStats(rawName, rawTimeWindow = "lifetime") {
  const apiKey = process.env.FORTNITE_API_KEY;
  if (!apiKey) throw fail("fortnite_not_configured", 503);
  const name = cleanPlayerName(rawName);
  const timeWindow = rawTimeWindow === "season" ? "season" : "lifetime";
  const params = new URLSearchParams({ name, accountType: "epic", timeWindow });
  let response;
  let lastNetworkError;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetch(`${FORTNITE_STATS_URL}?${params}`, {
        headers: { Authorization: apiKey },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status < 500 || attempt === maxAttempts) break;
      console.warn(JSON.stringify({ event: "fortnite_api_retry", attempt, status: response.status }));
      await response.body?.cancel();
    } catch (error) {
      lastNetworkError = error;
      if (attempt === maxAttempts) throw fail("fortnite_unavailable", 502, { cause: error });
      console.warn(JSON.stringify({ event: "fortnite_api_retry", attempt, error: error?.message }));
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 600));
  }
  if (!response) throw fail("fortnite_unavailable", 502, { cause: lastNetworkError });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status === 404 ? 404 : response.status === 403 ? 403 : 502;
    const code = response.status === 404 ? "player_not_found"
      : response.status === 403 ? "player_stats_private"
        : response.status === 429 ? "fortnite_rate_limited" : "fortnite_api_error";
    throw fail(code, status, { apiStatus: response.status, detail: body.error });
  }
  return normalizeStatsPayload(body.data, name, timeWindow);
}

module.exports = { getPlayerStats, getSkillVerdict, normalizeStatsPayload };
