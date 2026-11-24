// Fire Max - servidor de salas e amigos (WebSocket)
// Protocolo: hello, status, room, invite, join, leave, state, sq
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_ROOM = 4;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Fire Max server OK');
});
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const users = {}; // id -> { ws, name, room }
const rooms = {}; // room -> [ids]

const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const members = r => (rooms[r] || []).map(id => ({ id, name: (users[id] && users[id].name) || 'Jogador' }));
const toRoom = (r, m, exceptId) => (rooms[r] || []).forEach(id => { if (id !== exceptId && users[id]) send(users[id].ws, m); });

function leaveRoom(id) {
  const u = users[id]; if (!u || !u.room) return;
  const r = u.room; u.room = null;
  rooms[r] = (rooms[r] || []).filter(x => x !== id);
  send(u.ws, { t: 'left', id });
  toRoom(r, { t: 'left', id });
  if (!rooms[r].length) delete rooms[r];
}

function joinRoom(id, r) {
  const u = users[id]; if (!u) return;
  if (!rooms[r]) return send(u.ws, { t: 'error', msg: 'Sala não existe mais' });
  if (rooms[r].includes(id)) return send(u.ws, { t: 'joined', room: r, members: members(r) });
  if (rooms[r].length >= MAX_ROOM) return send(u.ws, { t: 'error', msg: 'Sala cheia' });
  if (u.room) leaveRoom(id);
  rooms[r].push(id); u.room = r;
  send(u.ws, { t: 'joined', room: r, members: members(r) });
  toRoom(r, { t: 'member', name: u.name, members: members(r) }, id);
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'hello') {
      const id = String(m.id || '').slice(0, 8); if (!id) return;
      const old = users[id];
      if (old && old.ws !== ws) { try { old.ws.terminate(); } catch (_) {} }
      users[id] = { ws, name: String(m.name || 'Jogador').slice(0, 20), room: old ? old.room : null };
      ws.uid = id;
      return send(ws, { t: 'ready' });
    }
    const id = ws.uid, u = users[id];
    if (!u || u.ws !== ws) return;

    if (m.t === 'status') {
      const ids = Array.isArray(m.friends) ? m.friends.slice(0, 100) : [];
      return send(ws, { t: 'status', friends: ids.map(f => ({ id: f, online: !!(users[f] && users[f].ws.readyState === 1), name: users[f] ? users[f].name : undefined })) });
    }
    if (m.t === 'room') {
      if (u.room) return send(ws, { t: 'joined', room: u.room, members: members(u.room) });
      const r = 'R' + Math.random().toString(36).slice(2, 8).toUpperCase();
      rooms[r] = [id]; u.room = r;
      return send(ws, { t: 'joined', room: r, members: members(r) });
    }
    if (m.t === 'invite') {
      const target = users[m.to];
      if (!u.room) return send(ws, { t: 'error', msg: 'Crie uma sala primeiro' });
      if (!target || target.ws.readyState !== 1) return send(ws, { t: 'error', msg: 'Amigo está offline' });
      return send(target.ws, { t: 'invite', fromName: u.name, from: id, room: u.room });
    }
    if (m.t === 'join') return joinRoom(id, String(m.room || ''));
    if (m.t === 'leave') return leaveRoom(id);
    if (m.t === 'state' || m.t === 'sq') {
      if (u.room) toRoom(u.room, Object.assign({}, m, { id }), id);
    }
  });
  ws.on('close', () => {
    const id = ws.uid;
    if (id && users[id] && users[id].ws === ws) { leaveRoom(id); delete users[id]; }
  });
  ws.on('error', () => {});
});

// derruba conexões mortas e mantém o Render acordado enquanto há gente online
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (_) {} });
}, 25000);

server.listen(PORT, () => console.log('Fire Max server na porta ' + PORT));
