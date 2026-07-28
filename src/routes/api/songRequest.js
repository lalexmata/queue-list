const express = require("express");
const {
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
} = require("../../services/songRequest.service");

const router = express.Router();

function sendError(res, error) {
  console.error("Song request error:", error);
  const status = error.status || 500;
  const code = error.status ? error.message : "db_error";
  const messages = {
    missing_song_input: "Debes escribir el nombre de una canción o pegar un enlace de YouTube.",
    invalid_youtube_url: "El enlace de YouTube no es válido.",
    youtube_search_not_configured: "La búsqueda por nombre todavía no está configurada.",
    youtube_search_failed: "YouTube no pudo completar la búsqueda en este momento.",
    youtube_video_not_found: "No se encontró una canción con ese nombre.",
    song_already_queued: "Esa canción ya está en la cola.",
    db_error: "No se pudo procesar la solicitud musical.",
    invalid_song_order: "El orden de las canciones no es válido.",
    song_queue_changed: "La cola cambió mientras la ordenabas. Inténtalo nuevamente.",
    invalid_volume: "El volumen debe ser un número entre 0 y 100.",
  };
  return res.status(status).json({ ok: false, error: code, message: messages[code] || code });
}

router.get("/queue", async (_req, res) => {
  try {
    const queue = await listSongRequests();
    const current = queue.find(song => song.status === "playing");
    const pending = queue.filter(song => song.status === "queued").length;
    const message = current
      ? `Ahora suena: ${current.title} | ${pending} canción(es) pendiente(s).`
      : pending
        ? `Hay ${pending} canción(es) esperando reproducción.`
        : "No hay solicitudes musicales pendientes.";
    res.json({ ok: true, size: queue.length, pending, message, queue });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/current", async (_req, res) => {
  try {
    const current = await getCurrentSong();
    const message = current
      ? `Ahora suena: ${current.title}, solicitada por ${current.requesterDisplayName}.`
      : "No hay una canción solicitada reproduciéndose.";
    res.json({ ok: true, message, current });
  } catch (error) {
    sendError(res, error);
  }
});

// Respuesta de texto plano para bots que no expanden propiedades JSON.
router.get("/current-message", async (_req, res) => {
  try {
    const current = await getCurrentSong();
    const message = current
      ? `Ahora suena: ${current.title}, solicitada por ${current.requesterDisplayName}.`
      : "No hay una canción solicitada reproduciéndose.";
    res.type("text/plain; charset=utf-8").send(message);
  } catch (error) {
    console.error("Song request current-message error:", error);
    res.status(500).type("text/plain; charset=utf-8").send("No se pudo consultar la canción actual.");
  }
});

router.get("/fallback-playlist", async (_req, res) => {
  try {
    res.json({ ok: true, playlist: await getFallbackPlaylist() });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/fallback-playlist", async (req, res) => {
  try {
    const input = req.body?.url ?? req.body?.playlistUrl ?? req.body?.playlistId ?? "";
    res.json({ ok: true, playlist: await setFallbackPlaylist(input) });
  } catch (error) {
    sendError(res, error);
  }
});

router.all("/volume", async (req, res) => {
  try {
    const source = { ...req.query, ...(req.body || {}) };
    const rawValue = source.volume ?? source.value ?? source.input;
    if (rawValue === undefined || String(rawValue).trim() === "") {
      const volume = await getPlaybackVolume();
      return res.json({ ok: true, volume, message: `El volumen está en ${volume}%.` });
    }

    let target = Number(rawValue);
    if (String(source.mode || "").toLowerCase() === "relative") {
      target = (await getPlaybackVolume()) + target;
      target = Math.max(0, Math.min(100, target));
    }
    const volume = await setPlaybackVolume(target);
    res.json({ ok: true, volume, message: `Volumen ajustado a ${volume}%.` });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/playback", async (_req, res) => {
  try {
    const paused = await getPlaybackPaused();
    res.json({ ok: true, paused, message: paused ? "La música está pausada." : "La música está reproduciéndose." });
  } catch (error) {
    sendError(res, error);
  }
});

router.all("/pause", async (_req, res) => {
  try {
    await setPlaybackPaused(true);
    res.json({ ok: true, paused: true, message: "La música fue pausada." });
  } catch (error) {
    sendError(res, error);
  }
});

router.all("/play", async (_req, res) => {
  try {
    await setPlaybackPaused(false);
    res.json({ ok: true, paused: false, message: "La reproducción musical continúa." });
  } catch (error) {
    sendError(res, error);
  }
});

// Admite JSON o query params para facilitar la integración con Streamer.bot.
router.all("/request", async (req, res) => {
  try {
    const source = { ...req.query, ...(req.body || {}) };
    const input = source.url || source.youtubeUrl || source.videoId || source.input;
    const requestedBy = String(
      source.requestedBy || source.uniqueId || source.uniqueid || source.username || source.user || ""
    ).trim();
    if (!requestedBy) return res.status(400).json({ ok: false, error: "missing_requested_by" });

    const song = await addSongRequest({
      input,
      requestedBy,
      requesterDisplayName: String(
        source.requesterDisplayName || source.nickname || source.displayName || source.name || requestedBy
      ),
      platform: String(source.platform || "twitch"),
    });
    const queue = await listSongRequests();
    const queued = queue.filter(item => item.status === "queued");
    const position = queued.findIndex(item => String(item.id) === String(song.id)) + 1;
    const message = `${song.requesterDisplayName}: “${song.title}” fue agregada a la cola${position ? ` en la posición ${position}` : ""}.`;
    res.status(201).json({ ok: true, message, position, song });
  } catch (error) {
    // Streamer.bot no siempre expande las propiedades JSON de respuestas HTTP 4xx.
    // Un duplicado es un resultado esperado, por lo que se responde con HTTP 200.
    if (error?.message === "song_already_queued") {
      return res.json({
        ok: false,
        status: "already_in_queue",
        error: "song_already_queued",
        message: "Esa canci\u00f3n ya est\u00e1 en la cola.",
      });
    }
    sendError(res, error);
  }
});

router.all("/next", async (_req, res) => {
  try {
    const current = await advanceSong("played");
    const message = current
      ? `Ahora suena: ${current.title}, solicitada por ${current.requesterDisplayName}.`
      : "No quedan solicitudes; continúa la playlist de respaldo.";
    res.json({ ok: true, message, current });
  } catch (error) {
    sendError(res, error);
  }
});

router.all("/skip", async (_req, res) => {
  try {
    const current = await advanceSong("skipped");
    const message = current
      ? `Canción saltada. Ahora suena: ${current.title}.`
      : "Canción saltada. No quedan solicitudes.";
    res.json({ ok: true, message, current });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/reorder", async (req, res) => {
  try {
    const queue = await reorderSongRequests(req.body?.ids);
    res.json({ ok: true, queue });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    const removed = await removeSongRequest(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: "song_not_found" });
    res.json({ ok: true, removed });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete("/", async (_req, res) => {
  try {
    res.json({ ok: true, removed: await clearSongRequests() });
  } catch (error) {
    sendError(res, error);
  }
});

module.exports = router;
