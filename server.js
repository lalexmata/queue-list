const express = require("express");
const livereload = require('livereload');
const connectLivereload = require('connect-livereload');
const fs = require("fs");
const path = require("path");
const {
  loadModCommands,
  addModCommand,
  deleteModCommand,
} = require("./helpers/modCommands.helper");
const { 
  resolveRole,
  insertByPriority
 } = require("./helpers");
const app = express();
// start livereload server and watch the public folder
const lrserver = livereload.createServer();
lrserver.watch(__dirname + '/pages');
app.use(express.json());

app.use(connectLivereload());

app.use(express.static('pages'));
// Servir estáticos (opcional)
app.use(express.static(path.join(__dirname, "pages")));
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

  // Evitar basura tipo "{var}" o "%var%"
  if (!uniqueId || String(uniqueId).includes("{") || String(uniqueId).includes("%")) {
    return res.status(400).json({ ok: false, error: "invalid uniqueId" });
  }

  const queue = loadQueue();

  // ✅ Role desde flags (isBroadcaster/isMod/isVip/isSub)
  const role = resolveRole({ ...req.query, ...(req.body || {}) }, uniqueId);

  const userObj = {
    uniqueId: String(uniqueId),
    nickname: String(nickname || uniqueId),
    ts: new Date().toISOString(),
    role,
    isSub: role === "subscriber", // compat
  };

  const sameIdx = queue.findIndex(
    u => String(u.uniqueId).toLowerCase() === String(uniqueId).toLowerCase()
  );

  // Si ya existe en cola: no duplicar, solo actualiza datos
  if (sameIdx !== -1) {
    queue[sameIdx] = { ...queue[sameIdx], ...userObj };

    // Si su rol cambió (por ejemplo se hizo VIP/SUB), lo recolocamos por prioridad
    const updated = queue.splice(sameIdx, 1)[0];
    const newPos = insertByPriority(queue, updated);

    saveQueue(queue);
    return res.json({
      ok: true,
      status: "updated",
      role,
      pos: newPos + 1,
      size: queue.length,
    });
  }

  // Nuevo: insertar por prioridad (mods/vip/sub adelante, viewers atrás)
  const pos = insertByPriority(queue, userObj);

  saveQueue(queue);
  return res.json({
    ok: true,
    status: "added",
    role,
    pos: pos + 1,
    size: queue.length,
  });
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

app.get("/cola", (req, res) => {
  res.sendFile(path.join(__dirname, "pages", "cola.html"));
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
  res.sendFile(path.join(__dirname, "pages", "admin.html"));
});
/*app.get("/admin", (req, res) => {
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
});*/

app.get("/api/comandos-mod", (req, res) => {
  res.json({
    ok: true,
    items: loadModCommands(),
  });
});

app.post("/api/comandos-mod/add", (req, res) => {
  const { command, description } = req.body;

  if (!command || !description) {
    return res.status(400).json({ ok: false });
  }

  const result = addModCommand(command, description);
  res.json({ ok: true, ...result });
});

app.post("/api/comandos-mod/delete", (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ ok: false });

  deleteModCommand(command);
  res.json({ ok: true });
});

app.post("/api/reorder", (req, res) => {
  const from = Number(req.body?.from);
  const to = Number(req.body?.to);

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return res.status(400).json({ ok: false, error: "from/to must be integers" });
  }

  const queue = loadQueue();

  if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) {
    return res.status(400).json({ ok: false, error: "index out of range" });
  }

  // ---- Regla SUB arriba ----
  const subCount = queue.filter(u => u?.isSub === true).length;

  const moving = queue[from];
  const movingIsSub = moving?.isSub === true;

  // Zona permitida:
  // - SUBs solo pueden quedar en [0 .. subCount-1]
  // - NO-SUBs solo pueden quedar en [subCount .. end]
  const allowedMin = movingIsSub ? 0 : subCount;
  const allowedMax = movingIsSub ? Math.max(subCount - 1, 0) : queue.length - 1;

  if (to < allowedMin || to > allowedMax) {
    return res.status(409).json({
      ok: false,
      error: "sub_rule_violation",
      message: movingIsSub
        ? "No puedes mover un SUB debajo de los no-SUB."
        : "No puedes mover un no-SUB por encima de los SUB."
    });
  }
  // --------------------------

  const [moved] = queue.splice(from, 1);
  queue.splice(to, 0, moved);

  saveQueue(queue);
  return res.json({ ok: true, size: queue.length, subCount });
});

app.get("/comandos-mod", (req, res) => {
  // si quieres que solo tú lo veas, activa esto:
  // if (!isAdmin(req)) return res.status(401).send("Unauthorized");
  res.sendFile(path.join(__dirname, "pages", "mod-comandos.html"));
/*
  res.end(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Comandos Moderación</title>
  <style>
    body { margin:0; padding:16px; font-family: Arial, sans-serif; background:#0b0b0b; color:#fff; }
    .wrap { max-width: 760px; margin: 0 auto; }
    .card { background:#141414; border:1px solid #222; border-radius:16px; padding:16px; }
    h1 { margin:0 0 12px; font-size:18px; }
    .row { display:flex; gap:10px; flex-wrap:wrap; margin-bottom: 12px; }
    input { flex:1; min-width:220px; padding:10px; border-radius:12px; border:1px solid #2a2a2a; background:#0f0f0f; color:#fff; }
    button { padding:10px 12px; border:0; border-radius:12px; font-weight:700; cursor:pointer; background:#2a2a2a; color:#fff; }
    button:hover { background:#3a3a3a; }
    .danger { background:#b91c1c; }
    .danger:hover { background:#dc2626; }
    table { width:100%; border-collapse: collapse; }
    th, td { padding:10px; border-bottom:1px solid #222; text-align:left; vertical-align:top; }
    th { font-size:12px; opacity:.85; }
    .cmd { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    .meta { font-size:12px; opacity:.75; margin-bottom:10px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>🛡️ Comandos para Moderadores</h1>
      <div class="meta">
        <div id="status">Cargando…</div>
        <div><button id="refresh">Refrescar</button></div>
      </div>

      <div class="row">
        <input id="command" placeholder="Comando (ej: !limpiar)" />
        <input id="description" placeholder="Descripción (qué hace)" />
        <button id="add">Agregar</button>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:160px">Comando</th>
            <th>Descripción</th>
            <th style="width:110px">Acción</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>

      <div id="empty" style="opacity:.8; padding:10px 0; display:none;">
        No hay comandos registrados todavía.
      </div>
    </div>
  </div>

<script>
  const tbody = document.getElementById('tbody');
  const statusEl = document.getElementById('status');
  const emptyEl = document.getElementById('empty');
  const key = new URLSearchParams(location.search).get('key') || "";

  function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  async function load() {
    const res = await fetch('/api/comandos-mod', { cache: 'no-store' });
    const data = await res.json();
    const items = data.items || [];

    statusEl.textContent = 'Actualizado: ' + new Date().toLocaleTimeString() + ' | Total: ' + items.length;

    tbody.innerHTML = '';
    if (!items.length) { emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';

    for (const it of items) {
      const tr = document.createElement('tr');
      tr.innerHTML = \`
        <td class="cmd">\${esc(it.command)}</td>
        <td>\${esc(it.description)}</td>
        <td><button class="danger" data-cmd="\${esc(it.command)}">Eliminar</button></td>
      \`;
      tr.querySelector('button.danger').addEventListener('click', async (e) => {
        const cmd = e.currentTarget.getAttribute('data-cmd');
        if (!cmd) return;
        if (!confirm('¿Eliminar ' + cmd + '?')) return;

        await fetch('/api/comandos-mod/delete' + (key ? ('?key=' + encodeURIComponent(key)) : ''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: cmd })
        });

        await load();
      });
      tbody.appendChild(tr);
    }
  }

  document.getElementById('refresh').addEventListener('click', load);

  document.getElementById('add').addEventListener('click', async () => {
    const command = document.getElementById('command').value.trim();
    const description = document.getElementById('description').value.trim();
    if (!command || !description) return alert('Completa comando y descripción');

    await fetch('/api/comandos-mod/add' + (key ? ('?key=' + encodeURIComponent(key)) : ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, description })
    });

    document.getElementById('command').value = '';
    document.getElementById('description').value = '';
    await load();
  });

  load();
</script>
</body>
</html>`);*/
});

const PORT = 5005;
app.listen(PORT, () => console.log(`TikQueue server running on http://127.0.0.1:${PORT}`));
