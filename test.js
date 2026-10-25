'use strict';
// Uji otomatis: 3 bot bermain acak sampai ada pemenang.
const WebSocket = require('ws');
const { server } = require('./server');

const PORT = 3999;
let finished = false;

function bot(name, cb) {
  const ws = new WebSocket('ws://localhost:' + PORT);
  const b = { ws, name, me: null, S: null, board: null };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'joined') { b.me = m.you; b.code = m.code; b.board = m.board; }
    if (m.t === 'err') console.log(name, 'ERR', m.m);
    if (m.t === 'state') { b.S = m.r; b.me = m.you; cb(b); }
  });
  return b;
}

let actions = 0, states = 0, built = 0;
function think(b) {
  states++;
  const S = b.S;
  if (S.phase === 'over') {
    if (!finished) {
      finished = true;
      const w = S.players.find((p) => p.id === S.winner);
      console.log(`SELESAI. Pemenang: ${w && w.name}. State=${states}, aksi=${actions}, rumah dibangun=${built}`);
      console.log(S.players.map((p) => `${p.name}: ${p.bankrupt ? 'bangkrut' : p.money}`).join(' | '));
      setTimeout(() => process.exit(0), 100);
    }
    return;
  }
  if (S.phase === 'lobby' || S.turn !== b.me) return;
  const me = S.players.find((p) => p.id === b.me);
  actions++;
  if (actions > 40000) { console.log('BATAS AKSI TERLAMPAUI'); process.exit(1); }
  const send = (o) => setImmediate(() => b.ws.send(JSON.stringify(o)));
  if (S.phase === 'roll') {
    if (me.inBekasi && me.jailFree && Math.random() < 0.5) return send({ t: 'leave', how: 'card' });
    return send({ t: 'roll' });
  }
  if (S.phase === 'buy') return send({ t: Math.random() < 0.8 ? 'buy' : 'skip' });
  if (S.phase === 'end') {
    // coba bangun rumah di semua tanah sendiri
    for (const t of b.board) {
      if (t.type === 'prop' && S.owner[t.i] === b.me && Math.random() < 0.5) { built++; return send({ t: 'build', tile: t.i }); }
    }
    return send({ t: 'end' });
  }
}

server.listen(PORT, () => {
  const a = bot('Andi', (b) => { if (!a.started && a.S && a.S.players.length === 3) { a.started = true; a.ws.send(JSON.stringify({ t: 'start' })); } think(b); });
  a.ws.on('open', () => a.ws.send(JSON.stringify({ t: 'create', name: 'Andi' })));
  setTimeout(() => {
    const mk = (n) => { const x = bot(n, think); x.ws.on('open', () => x.ws.send(JSON.stringify({ t: 'join', room: a.code, name: n }))); return x; };
    mk('Budi'); mk('Cici');
  }, 300);
});
setTimeout(() => { console.log('TIMEOUT: game tidak selesai'); process.exit(1); }, 120000);
