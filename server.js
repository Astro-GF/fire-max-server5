// Fire Max - servidor de salas e amigos (WebSocket)
// Uso: node server.js  (porta: variável PORT, padrão 8080)
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const online = new Map();   // id -> { ws, name, room }
const rooms = new Map();    // roomId -> Set of ids (máx. 4)
const MAX_ROOM = 4;

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function roomOf(id) { const p = online.get(id); return p && p.room ? rooms.get(p.room) : null; }
function leaveRoom(id) {
  const p = online.get(id); if (!p || !p.room) return;
  const set = rooms.get(p.room);
  if (set) {
    set.delete(id);
    set.forEach(o => send(online.get(o)?.ws, { t: 'left', id }));
    if (set.size === 0) rooms.delete(p.room);
  }
  p.room = null;
}
function friendsStatus(ids) {
  return ids.map(f => ({ id: f, online: online.has(f), room: online.get(f)?.room || null }));
}

wss.on('connection', ws => {
  let me = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (m.t === 'hello') {
      if (!/^[A-Z0-9]{8}$/.test(m.id || '')) return send(ws, { t: 'error', msg: 'ID inválido' });
      if (online.has(m.id)) { try { online.get(m.id).ws.close(); } catch (_) {} }
      me = m.id;
      online.set(me, { ws, name: String(m.name || 'Jogador').slice(0, 16), room: null });
      send(ws, { t: 'ready', id: me });
    } else if (!me) {
      return;
    } else if (m.t === 'status') {                  // pede status de amigos
      send(ws, { t: 'status', friends: friendsStatus(Array.isArray(m.friends) ? m.friends.slice(0, 200) : []) });
    } else if (m.t === 'room') {                     // cria sala com o próprio ID
      leaveRoom(me);
      const rid = me;
      rooms.set(rid, new Set([me])); online.get(me).room = rid;
      send(ws, { t: 'joined', room: rid, members: [{ id: me, name: online.get(me).name }] });
    } else if (m.t === 'invite') {                   // convite para um amigo
      const to = online.get(m.to);
      if (!to) return send(ws, { t: 'error', msg: 'Amigo offline' });
      send(to.ws, { t: 'invite', from: me, fromName: online.get(me).name, room: online.get(me).room });
    } else if (m.t === 'join') {                     // aceita convite / entra em sala
      const set = rooms.get(m.room);
      if (!set) return send(ws, { t: 'error', msg: 'Sala não existe mais' });
      if (set.size >= MAX_ROOM) return send(ws, { t: 'error', msg: 'Sala cheia' });
      leaveRoom(me);
      set.add(me); online.get(me).room = m.room;
      const members = [...set].map(id => ({ id, name: online.get(id).name }));
      set.forEach(o => send(online.get(o).ws, { t: 'member', id: me, name: online.get(me).name, members }));
      send(ws, { t: 'joined', room: m.room, members });
    } else if (m.t === 'leave') {
      leaveRoom(me); send(ws, { t: 'left', id: me });
    } else if (m.t === 'state') {                    // posição e animação, repassa aos colegas
      const set = roomOf(me); if (!set) return;
      const data = { t: 'state', id: me, x: +m.x || 0, y: +m.y || 0, z: +m.z || 0, ry: +m.ry || 0, anim: String(m.anim || 'idle').slice(0, 20), weapon: String(m.weapon || 'soco').slice(0, 12), alive: m.alive !== false };
      set.forEach(o => { if (o !== me) send(online.get(o)?.ws, data); });
    } else if (m.t === 'shot') {                     // evento de tiro (visual), repassa
      const set = roomOf(me); if (!set) return;
      set.forEach(o => { if (o !== me) send(online.get(o)?.ws, { t: 'shot', id: me, weapon: String(m.weapon || 'ak').slice(0, 12) }); });
    }
  });
  ws.on('close', () => {
    if (!me) return;
    leaveRoom(me);
    if (online.get(me)?.ws === ws) online.delete(me);
  });
});
console.log('Fire Max server na porta ' + PORT);
