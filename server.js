const express = require("express");
const livereload = require('livereload');
const connectLivereload = require('connect-livereload');
const fs = require("fs");
const path = require("path");

const app = express();
// start livereload server and watch the public folder
const lrserver = livereload.createServer();
lrserver.watch(__dirname + '/public');
app.use(express.json());

app.use(connectLivereload());
app.use(express.static('public'));
const DATA_DIR = path.join(__dirname, "data");
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");
const CSV_FILE = path.join(DATA_DIR, "queue.csv");


function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, JSON.stringify({ queue: [] }, null, 2), "utf8");
  if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, "pos,uniqueId,nickname,ts\n", "utf8");
}

function loadQueue() {
  ensureFiles();
  return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8")).queue || [];
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify({ queue }, null, 2), "utf8");
  // Reescribe CSV completo (simple y seguro)
  const header = "pos,uniqueId,nickname,ts\n";
  const lines = queue.map((u, i) => `${i + 1},${u.uniqueId},${u.nickname},${u.ts}`).join("\n");
  fs.writeFileSync(CSV_FILE, header + (lines ? lines + "\n" : ""), "utf8");
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log("----");
  console.log("REQ", req.method, req.url);
  console.log("QUERY", req.query);
  console.log("BODY", req.body);
  next();
});

// Endpoint para !jugar
app.all("/jugar", (req, res) => {
  const uniqueId =
    (req.body && (req.body.uniqueId || req.body.uniqueid || req.body.user || req.body.username)) ||
    req.query.uniqueId ||
    req.query.uniqueid ||
    req.query.user ||
    req.query.username ||
    "";

  const nickname =
    (req.body && (req.body.nickname || req.body.displayName || req.body.name)) ||
    req.query.nickname ||
    req.query.displayName ||
    req.query.name ||
    uniqueId;

  const isSubRaw =
    (req.body && (req.body.isSub ?? req.body.issub)) ??
    (req.query.isSub ?? req.query.issub);

  const isSub =
    isSubRaw === true ||
    String(isSubRaw).toLowerCase() === "true" ||
    String(isSubRaw) === "1";

  // Evitar basura tipo "{var}" o "%var%"
  if (!uniqueId || String(uniqueId).includes("{") || String(uniqueId).includes("%")) {
    return res.status(400).json({ ok: false, error: "invalid uniqueId" });
  }

  const queue = loadQueue();

  const userObj = {
    uniqueId: String(uniqueId),
    nickname: String(nickname || uniqueId),
    ts: new Date().toISOString(),
    isSub: Boolean(isSub)
  };

  const sameIdx = queue.findIndex(
    u => String(u.uniqueId).toLowerCase() === String(uniqueId).toLowerCase()
  );

  // Si ya existe en cola:
  if (sameIdx !== -1) {
    // Si es sub y NO hay sub en el puesto 1, lo movemos a 1
    const firstIsSub = queue[0]?.isSub === true;

    if (isSub && !firstIsSub && sameIdx !== 0) {
      queue.splice(sameIdx, 1);
      queue.unshift({ ...queue[0], ...userObj }); // mantiene estructura, actualiza isSub/ts/nickname
      saveQueue(queue);
      return res.json({ ok: true, status: "moved_to_front", pos: 1, size: queue.length });
    }

    // Si ya hay sub primero, NO le quitamos el puesto
    return res.json({ ok: true, status: "already_in_queue", pos: sameIdx + 1, size: queue.length });
  }

  // Nuevo: insertar
  if (isSub) {
    const firstIsSub = queue[0]?.isSub === true;

    if (!firstIsSub) {
      // No hay sub primero => este sub entra primero
      queue.unshift(userObj);
      saveQueue(queue);
      return res.json({ ok: true, status: "added_to_front", pos: 1, size: queue.length });
    }

    // Ya hay sub en el puesto 1 => NO le quitamos el puesto
    // Opción: ponerlo justo después del primer sub (posición 2)
    queue.splice(1, 0, userObj);
    saveQueue(queue);
    return res.json({ ok: true, status: "added_after_first_sub", pos: 2, size: queue.length });
  }

  // No sub => al final
  queue.push(userObj);
  saveQueue(queue);
  return res.json({ ok: true, status: "added", pos: queue.length, size: queue.length });
});




// Endpoint para ver cola
app.get("/lista", (req, res) => {
  const queue = loadQueue();
  res.json({ ok: true, size: queue.length, queue });
});

// Endpoint para ver cola solo nombres y posiciones
app.get("/lista", (req, res) => {
  const queue = loadQueue();
  const queueOrdered = queue.map((user, index) => ({ position: index + 1, ...user }));
  
  res.json({ ok: true, size: queue.length, queue: queueOrdered });
});

// ✅ API: devuelve la cola en JSON (para que el HTML la consulte)
app.get("/api/cola", (req, res) => {
  const queue = loadQueue();
  res.json({ ok: true, size: queue.length, queue });
});

// ✅ HTML: muestra la cola (overlay)
app.get("/cola", (req, res) => {
  const platform = String(req.query.platform || "").toLowerCase();
  const callToAction =
    platform === "tiktok"
      ? "Escribe <b>!jugar</b> para apuntarte"
      : "Canjea puntos del canal para apuntarte";

  res.setHeader("ngrok-skip-browser-warning", "1");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  
  // refresco cada 4 min = 240000 ms
  const refreshMs = 10000;

  res.end(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cola</title>

  <!-- Refresco "hard" del navegador cada 4 min (opcional, lo dejamos) -->
  <meta http-equiv="refresh" content="10">

  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 16px; background: transparent; color: #fff; }
    .card { background: rgba(0,0,0,0.65); border-radius: 14px; padding: 14px 16px; width: 290px; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    .meta { font-size: 12px; opacity: .85; margin-bottom: 10px; }
    ol { margin: 0; padding-left: 22px; }
    li { margin: 6px 0; font-size: 16px; }
    .empty { font-size: 14px; opacity: .9; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎮 Lista de espera por Jugar</h1>
    <p>${callToAction}</p>
    <div class="meta" id="meta">Cargando...</div>
    <ol id="list"></ol>
    <div class="empty" id="empty" style="display:none;">No hay nadie en espera por jugar. Canjea <b>!Juega conmigo</b></div>
  </div>

  <script>
    const refreshMs = ${refreshMs};

    async function load() {
      try {
        const res = await fetch('/api/cola', { cache: 'no-store' });
        const data = await res.json();

        const list = document.getElementById('list');
        const meta = document.getElementById('meta');
        const empty = document.getElementById('empty');

        list.innerHTML = '';

        const now = new Date();
        meta.textContent = \`Actualizado: \${now.toLocaleTimeString()} | En espera: \${data.size}\`;

        if (!data.queue || data.queue.length === 0) {
          empty.style.display = 'block';
          return;
        }

        empty.style.display = 'none';

        // Muestra los primeros 15 (ajusta si quieres)
        data.queue.slice(0, 10).forEach((u, i) => {
          const li = document.createElement('li');
          // nickname si existe, si no uniqueId
          const name = (u.nickname || u.uniqueId || 'usuario').toString();
          li.textContent = \`\${name}\`;
          list.appendChild(li);
        });
      } catch (e) {
        document.getElementById('meta').textContent = 'Error cargando lista';
      }
    }

    load();
    setInterval(load, refreshMs); // ✅ refresco cada 4 min sin recargar toda la página
  </script>
</body>
</html>`);
});

// Endpoint para sacar al siguiente
app.post("/siguiente", async (req, res) => {
  const queue = loadQueue();
  const next = queue.shift() || null;
  // dentro de /siguiente (después de obtener next.nickname):
  await fetch("http://127.0.0.1:7474/DoAction", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: { name: "TT - Decir en chat" },   // o usa id si prefieres
    args: {
      msg: `🎯 Turno de @${next.nickname} | ¡Tienes 60s para entrar!`
    }
  })
});
  saveQueue(queue);
  res.json({ ok: true, next, size: queue.length });
});

app.all("/limpiar", (req, res) => {
  try {
    // Vaciar la cola
    saveQueue([]);

    return res.json({
      ok: true,
      message: "Cola limpiada correctamente",
      size: 0
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "No se pudo limpiar la cola"
    });
  }
});

// Endpoint para salir
app.all("/salir", (req, res) => {
  // Intenta leer el ID del usuario desde varias claves posibles
  const uniqueId =
    (req.body && (req.body.uniqueId || req.body.uniqueid || req.body.user || req.body.username)) ||
    req.query.uniqueId ||
    req.query.uniqueid ||
    req.query.user ||
    req.query.username ||
    "";

  if (!uniqueId) {
    return res.status(400).json({
      ok: false,
      error: "missing uniqueId (TikFinity no envió usuario)"
    });
  }

  const queue = loadQueue();
  const idx = queue.findIndex(
    u => String(u.uniqueId).toLowerCase() === String(uniqueId).toLowerCase()
  );

  if (idx === -1) {
    return res.json({
      ok: true,
      status: "not_in_queue",
      uniqueId,
      size: queue.length
    });
  }

  const removed = queue.splice(idx, 1)[0];
  saveQueue(queue);

  return res.json({
    ok: true,
    status: "removed",
    removed,
    size: queue.length
  });
});

app.all("/api/remove", (req, res) => {
  const uniqueId = String(req.query.uniqueId || "").trim();

  if (!uniqueId) {
    return res.status(400).json({ ok: false, error: "missing uniqueId" });
  }

  const queue = loadQueue();
  const idx = queue.findIndex(
    u => String(u.uniqueId).toLowerCase() === uniqueId.toLowerCase()
  );

  if (idx === -1) {
    return res.json({ ok: true, status: "not_found", size: queue.length });
  }

  const removed = queue.splice(idx, 1)[0];
  saveQueue(queue);

  return res.json({ ok: true, status: "removed", removed, size: queue.length });
});

app.get("/admin", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  res.end(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Cola</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 16px; background: #0b0b0b; color: #fff; }
    .wrap { max-width: 560px; margin: 0 auto; }
    .card { background: #141414; border: 1px solid #222; border-radius: 14px; padding: 14px 16px; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    .meta { font-size: 12px; opacity: .8; margin-bottom: 10px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
    button { cursor: pointer; border: 0; border-radius: 10px; padding: 8px 10px; font-weight: 600; }
    .btn { background: #2a2a2a; color: #fff; }
    .btn:hover { background: #3a3a3a; }
    .danger { background: #b91c1c; color: #fff; }
    .danger:hover { background: #dc2626; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display:flex; align-items:center; justify-content:space-between; gap:10px; padding: 10px 0; border-bottom: 1px solid #222; }
    .left { display:flex; flex-direction:column; gap:2px; }
    .name { font-size: 16px; }
    .sub { font-size: 12px; opacity:.8; }
    .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background:#1f2937; display:inline-block; margin-left:6px; }
    .pill.sub { background:#065f46; }
    .rowbtns { display:flex; gap:8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>🛠️ Admin Cola</h1>
      <div class="meta">
        <div id="meta">Cargando…</div>
        <div style="display:flex; gap:8px;">
          <button class="btn" id="refresh">Refrescar</button>
          <button class="danger" id="clear">Limpiar todo</button>
        </div>
      </div>

      <ul id="list"></ul>
      <div id="empty" style="opacity:.85; display:none; padding: 10px 0;">No hay nadie en la cola.</div>
    </div>
  </div>

<script>
  const listEl = document.getElementById('list');
  const metaEl = document.getElementById('meta');
  const emptyEl = document.getElementById('empty');

  async function loadQueue() {
    const res = await fetch('/api/cola', { cache: 'no-store' });
    return await res.json();
  }

  function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  async function render() {
    const data = await loadQueue();
    const q = data.queue || [];
    const now = new Date();
    metaEl.textContent = 'Actualizado: ' + now.toLocaleTimeString() + ' | En cola: ' + q.length;

    listEl.innerHTML = '';
    if (!q.length) { emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';

    q.forEach((u, i) => {
      const uid = u.uniqueId || '';
      const name = u.nickname || uid || 'usuario';
      const isSub = u.isSub === true;

      const li = document.createElement('li');
      li.innerHTML = \`
        <div class="left">
          <div class="name">#\${i+1} \${esc(name)} \${isSub ? '<span class="pill sub">SUB</span>' : ''}</div>
          <div class="sub">@\${esc(uid)}</div>
        </div>
        <div class="rowbtns">
          <button class="danger" data-uid="\${esc(uid)}">Eliminar</button>
        </div>
      \`;

      li.querySelector('button.danger').addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-uid');
        if (!id) return;

        if (!confirm('¿Eliminar a @' + id + ' de la cola?')) return;

        await fetch('/api/remove?uniqueId=' + encodeURIComponent(id), { method: 'POST' });
        await render();
      });

      listEl.appendChild(li);
    });
  }

  document.getElementById('refresh').addEventListener('click', render);

  document.getElementById('clear').addEventListener('click', async () => {
    if (!confirm('¿Seguro que quieres limpiar TODA la cola?')) return;
    await fetch('/limpiar', { method: 'POST' });
    await render();
  });

  render();
  setInterval(render, 10000); // refresco cada 10s (ajústalo si quieres)
</script>
</body>
</html>`);
});

const PORT = 5005;
app.listen(PORT, () => console.log(`TikQueue server running on http://127.0.0.1:${PORT}`));
