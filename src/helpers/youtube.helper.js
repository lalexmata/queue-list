function parseYouTubeId(input) {
  const value = String(input || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let candidate = null;

  if (host === "youtu.be") {
    candidate = url.pathname.split("/").filter(Boolean)[0];
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "live", "embed"].includes(parts[0])) candidate = parts[1];
    }
  }

  return /^[A-Za-z0-9_-]{11}$/.test(candidate || "") ? candidate : null;
}

function parseYouTubePlaylistId(input) {
  const value = String(input || "").trim();
  if (/^[A-Za-z0-9_-]{10,80}$/.test(value)) return value;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) return null;
    const playlistId = url.searchParams.get("list");
    return /^[A-Za-z0-9_-]{10,80}$/.test(playlistId || "") ? playlistId : null;
  } catch {
    return null;
  }
}

module.exports = { parseYouTubeId, parseYouTubePlaylistId };
