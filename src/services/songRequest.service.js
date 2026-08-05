const { pool } = require("../database/db");
const { parseYouTubeId, parseYouTubePlaylistId } = require("../helpers/youtube.helper");
const { findOrCreateCommunityProfile } = require("./community-profile.service");

const SONG_COLUMNS = `
  id,
  profile_id AS "profileId",
  youtube_id AS "youtubeId",
  youtube_url AS "youtubeUrl",
  title,
  thumbnail_url AS "thumbnailUrl",
  requested_by AS "requestedBy",
  requester_display_name AS "requesterDisplayName",
  platform,
  status,
  sort_order AS "sortOrder",
  requested_at AS "requestedAt",
  started_at AS "startedAt",
  finished_at AS "finishedAt"`;

async function fetchYouTubeMetadata(youtubeId) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  try {
    const params = new URLSearchParams({ url: youtubeUrl, format: "json" });
    const response = await fetch(`https://www.youtube.com/oembed?${params}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`YouTube oEmbed HTTP ${response.status}`);
    const data = await response.json();
    return {
      title: String(data.title || `YouTube ${youtubeId}`),
      thumbnailUrl: data.thumbnail_url || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  } catch (error) {
    console.warn("YouTube oEmbed metadata unavailable:", error.message);
    return {
      title: `YouTube ${youtubeId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }
}

async function searchYouTube(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("youtube_search_not_configured"), { status: 503 });
  }

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: "1",
    safeSearch: "moderate",
    q: String(query),
    key: apiKey,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
    signal: AbortSignal.timeout(6000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("YouTube search error:", data.error || data);
    throw Object.assign(new Error("youtube_search_failed"), { status: 502 });
  }

  const youtubeId = data.items?.[0]?.id?.videoId;
  if (!youtubeId) throw Object.assign(new Error("youtube_video_not_found"), { status: 404 });
  return youtubeId;
}

async function resolveYouTubeInput(input) {
  const value = String(input || "").trim();
  if (!value) throw Object.assign(new Error("missing_song_input"), { status: 400 });

  const youtubeId = parseYouTubeId(value);
  if (youtubeId) return youtubeId;
  if (/^https?:\/\//i.test(value)) {
    throw Object.assign(new Error("invalid_youtube_url"), { status: 400 });
  }
  return searchYouTube(value);
}

async function addSongRequest({ input, requestedBy, requesterDisplayName, platform = "twitch" }) {
  const youtubeId = await resolveYouTubeInput(input);
  const normalizedPlatform = String(platform || "twitch").trim().toLowerCase();

  const metadata = await fetchYouTubeMetadata(youtubeId);
  const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const profileId = normalizedPlatform === "admin" ? null : await findOrCreateCommunityProfile(client, {
      platform: normalizedPlatform, userId: requestedBy, displayName: requesterDisplayName || requestedBy,
    });
    const { rows } = await client.query(
      `INSERT INTO song_requests
        (profile_id, youtube_id, youtube_url, title, thumbnail_url, requested_by, requester_display_name, platform, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
         (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM song_requests))
       RETURNING ${SONG_COLUMNS}`,
      [profileId, youtubeId, youtubeUrl, metadata.title, metadata.thumbnailUrl, requestedBy,
        requesterDisplayName || requestedBy, normalizedPlatform]
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw Object.assign(new Error("song_already_queued"), { status: 409 });
    }
    throw error;
  } finally {
    client.release();
  }
}

async function listSongRequests() {
  const { rows } = await pool.query(
    `SELECT ${SONG_COLUMNS}
     FROM song_requests
     WHERE status IN ('playing', 'queued')
     ORDER BY CASE status WHEN 'playing' THEN 0 ELSE 1 END,
              sort_order ASC NULLS LAST, requested_at ASC, id ASC`
  );
  return rows;
}

async function getCurrentSong() {
  const { rows } = await pool.query(
    `SELECT ${SONG_COLUMNS} FROM song_requests
     WHERE status = 'playing' ORDER BY started_at ASC, id ASC LIMIT 1`
  );
  return rows[0] || null;
}

async function advanceSong(currentStatus = "played") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE song_requests SET status = $1, finished_at = NOW()
       WHERE status = 'playing'`,
      [currentStatus]
    );
    const { rows } = await client.query(
      `UPDATE song_requests SET status = 'playing', started_at = NOW()
       WHERE id = (
         SELECT id FROM song_requests WHERE status = 'queued'
         ORDER BY sort_order ASC NULLS LAST, requested_at ASC, id ASC
         FOR UPDATE SKIP LOCKED LIMIT 1
       ) RETURNING ${SONG_COLUMNS}`
    );
    await client.query("COMMIT");
    return rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function removeSongRequest(id) {
  const { rows } = await pool.query(
    `DELETE FROM song_requests WHERE id = $1 AND status = 'queued'
     RETURNING ${SONG_COLUMNS}`,
    [id]
  );
  return rows[0] || null;
}

async function reorderSongRequests(ids) {
  if (!Array.isArray(ids) || ids.some(id => !/^\d+$/.test(String(id)))) {
    throw Object.assign(new Error("invalid_song_order"), { status: 400 });
  }
  const normalizedIds = ids.map(String);
  if (new Set(normalizedIds).size !== normalizedIds.length) {
    throw Object.assign(new Error("invalid_song_order"), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id::text AS id FROM song_requests
       WHERE status = 'queued'
       ORDER BY sort_order ASC NULLS LAST, requested_at ASC, id ASC
       FOR UPDATE`
    );
    const queuedIds = rows.map(row => row.id);
    if (queuedIds.length !== normalizedIds.length ||
        queuedIds.some(id => !normalizedIds.includes(id))) {
      throw Object.assign(new Error("song_queue_changed"), { status: 409 });
    }
    await client.query(
      `UPDATE song_requests AS song
       SET sort_order = requested.position
       FROM unnest($1::bigint[]) WITH ORDINALITY AS requested(id, position)
       WHERE song.id = requested.id AND song.status = 'queued'`,
      [normalizedIds]
    );
    await client.query("COMMIT");
    return listSongRequests();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function clearSongRequests() {
  const { rowCount } = await pool.query(
    `DELETE FROM song_requests WHERE status IN ('queued', 'playing')`
  );
  return rowCount;
}

async function getFallbackPlaylist() {
  const { rows } = await pool.query(
    `SELECT fallback_playlist_id AS "playlistId",
            fallback_playlist_url AS "playlistUrl",
            updated_at AS "updatedAt"
     FROM song_request_settings WHERE id = 1`
  );
  return rows[0] || { playlistId: null, playlistUrl: null, updatedAt: null };
}

async function setFallbackPlaylist(input) {
  const value = String(input || "").trim();
  const playlistId = value ? parseYouTubePlaylistId(value) : null;
  if (value && !playlistId) {
    throw Object.assign(new Error("invalid_youtube_playlist_url"), { status: 400 });
  }
  const playlistUrl = playlistId
    ? `https://www.youtube.com/playlist?list=${playlistId}`
    : null;
  const { rows } = await pool.query(
    `INSERT INTO song_request_settings (id, fallback_playlist_id, fallback_playlist_url, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET
       fallback_playlist_id = EXCLUDED.fallback_playlist_id,
       fallback_playlist_url = EXCLUDED.fallback_playlist_url,
       updated_at = NOW()
     RETURNING fallback_playlist_id AS "playlistId",
               fallback_playlist_url AS "playlistUrl",
               updated_at AS "updatedAt"`,
    [playlistId, playlistUrl]
  );
  return rows[0];
}

async function getPlaybackVolume() {
  const { rows } = await pool.query(
    `SELECT playback_volume AS volume FROM song_request_settings WHERE id = 1`
  );
  return Number(rows[0]?.volume ?? 100);
}

async function setPlaybackVolume(value) {
  const volume = Number(value);
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    throw Object.assign(new Error("invalid_volume"), { status: 400 });
  }
  const { rows } = await pool.query(
    `INSERT INTO song_request_settings (id, playback_volume, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET playback_volume = EXCLUDED.playback_volume, updated_at = NOW()
     RETURNING playback_volume AS volume`,
    [volume]
  );
  return Number(rows[0].volume);
}

async function getPlaybackPaused() {
  const { rows } = await pool.query(
    `SELECT playback_paused AS paused FROM song_request_settings WHERE id = 1`
  );
  return rows[0]?.paused === true;
}

async function setPlaybackPaused(paused) {
  const { rows } = await pool.query(
    `INSERT INTO song_request_settings (id, playback_paused, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET playback_paused = EXCLUDED.playback_paused, updated_at = NOW()
     RETURNING playback_paused AS paused`,
    [paused === true]
  );
  return rows[0].paused === true;
}

module.exports = {
  addSongRequest,
  listSongRequests,
  getCurrentSong,
  advanceSong,
  removeSongRequest,
  clearSongRequests,
  getFallbackPlaylist,
  setFallbackPlaylist,
  getPlaybackVolume,
  setPlaybackVolume,
  getPlaybackPaused,
  setPlaybackPaused,
  reorderSongRequests,
};
