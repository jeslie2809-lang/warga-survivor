'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/* ---------------------------------------------------------------- konstanta */
const START_MONEY = 8000000;
const GAJIAN = Number(process.env.GAJIAN) || 700000;
const TEBUS = 1000000;
const MAX_PLAYERS = 5;
const MAX_ROOMS = 200;
const MIN_GAP = process.env.MIN_GAP !== undefined ? Number(process.env.MIN_GAP) : 80; // anti-spam (ms)
const TURN_MS = 75000;
const AFK_MS = 3500;
const PLAYER_COLORS = ['#e63946', '#2a9d8f', '#f4a261', '#8e5fd1', '#1d7bd8'];
const GROUP_COLORS = {
  brown: '#8d5a3b', sky: '#5bc0eb', pink: '#e86fa8', orange: '#f08a24',
  red: '#d7263d', yellow: '#f2c14e', green: '#2e9e5b', blue: '#2b4eb5',
};

/* ------------------------------------------------------------------- papan */
const P = (name, group, price) => ({ type: 'prop', name, group, price });
const BOARD = [
  { type: 'start', name: 'Gajian' },
  P('Kontrakan Petakan', 'brown', 600000),
  { type: 'takdir', name: 'Kartu Takdir' },
  P('Kos-kosan Murah', 'brown', 600000),
  { type: 'tax', name: 'Pajak Tahunan', amount: 1000000 },
  P('Warung Tegal', 'sky', 1000000),
  { type: 'musibah', name: 'Kartu Musibah' },
  P('Angkringan', 'sky', 1000000),
  { type: 'bekasi', name: 'Bekasi' },
  P('Ruko Pinggir Jalan', 'pink', 1400000),
  { type: 'takdir', name: 'Kartu Takdir' },
  P('Bengkel Motor', 'pink', 1400000),
  { type: 'tilang', name: 'Razia Tilang', amount: 500000 },
  P('Toko Online', 'orange', 1800000),
  { type: 'musibah', name: 'Kartu Musibah' },
  P('Warnet Gaming', 'orange', 1800000),
  { type: 'libur', name: 'Libur Nasional' },
  P('Rumah Subsidi', 'red', 2200000),
  { type: 'takdir', name: 'Kartu Takdir' },
  P('Perumahan Cluster', 'red', 2200000),
  { type: 'pemilu', name: 'Pemilu' },
  P('Ruko 3 Lantai', 'yellow', 2800000),
  { type: 'musibah', name: 'Kartu Musibah' },
  P('Kafe Estetik', 'yellow', 2800000),
  { type: 'viral', name: 'Digoreng Netizen' },
  P('Villa Puncak', 'green', 3400000),
  { type: 'takdir', name: 'Kartu Takdir' },
  P('Tanah Kavling', 'green', 3400000),
  { type: 'pungli', name: 'Pungli Oknum', amount: 800000 },
  P('Apartemen SCBD', 'blue', 4200000),
  { type: 'musibah', name: 'Kartu Musibah' },
  P('Penthouse Sudirman', 'blue', 4200000),
];
const r10k = (n) => Math.round(n / 10000) * 10000;
BOARD.forEach((t, i) => {
  t.i = i;
  if (t.type === 'prop') {
    t.rent = [0.1, 0.5, 1.2, 2.2].map((m) => r10k(t.price * m));
    t.house = r10k(t.price * 0.5);
  }
});
const BOARD_LEN = BOARD.length; // 32

/* ------------------------------------------------------------------ helper */
const rooms = new Map();
const rnd = (n) => Math.floor(Math.random() * n);
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, n);
const rp = (n) => 'Rp' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const alive = (r) => r.players.filter((p) => !p.bankrupt);
const byId = (r, id) => r.players.find((p) => p.id === id);
const cur = (r) => r.players[r.turn];

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[rnd(A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function log(r, x) { r.log.push({ x }); if (r.log.length > 120) r.log.shift(); }
function setDeadline(r) {
  const p = cur(r);
  r.deadline = Date.now() + (p && p.connected ? TURN_MS : AFK_MS);
}

/* --------------------------------------------------------------- logika game */
function resetPlayer(p) {
  p.money = START_MONEY; p.pos = 0; p.inBekasi = false; p.attempts = 0;
  p.skip = 0; p.jailFree = 0; p.bankrupt = false;
}

function checkWin(r) {
  if (r.phase === 'lobby' || r.phase === 'over') return r.phase === 'over';
  const a = alive(r);
  if (a.length <= 1) {
    r.phase = 'over';
    r.winner = a[0] ? a[0].id : null;
    if (a[0]) log(r, `🏆 ${a[0].name} adalah satu-satunya yang masih bertahan hidup. Selamat, kamu menang!`);
    return true;
  }
  return false;
}

function bankrupt(r, p, to) {
  p.bankrupt = true;
  p.money = 0;
  log(r, `💀 ${p.name} bangkrut${to ? ` dan asetnya disita ${to.name}` : ' dan asetnya kembali ke negara'}.`);
  for (const k of Object.keys(r.owner)) {
    if (r.owner[k] === p.id) {
      if (to && !to.bankrupt) r.owner[k] = to.id;
      else { delete r.owner[k]; delete r.houses[k]; }
    }
  }
  if (to && !to.bankrupt) to.jailFree += p.jailFree;
  p.jailFree = 0;
  checkWin(r);
}

// bayar ke pemain lain (to) atau ke bank (to=null). false = pemain bangkrut.
function pay(r, p, to, amt) {
  if (amt <= 0 || p.bankrupt) return true;
  if (p.money >= amt) { p.money -= amt; if (to) to.money += amt; return true; }
  if (to && !to.bankrupt) to.money += p.money;
  p.money = 0;
  bankrupt(r, p, to);
  return false;
}

function groupOwnedBy(r, t, pid) {
  return BOARD.filter((x) => x.group === t.group).every((x) => r.owner[x.i] === pid);
}
function rentOf(r, i) {
  const t = BOARD[i];
  const lvl = r.houses[i] || 0;
  let base = t.rent[lvl];
  if (lvl === 0 && groupOwnedBy(r, t, r.owner[i])) base *= 2;
  return base;
}

function move(r, p, n) {
  const np = (((p.pos + n) % BOARD_LEN) + BOARD_LEN) % BOARD_LEN;
  if (n > 0 && p.pos + n >= BOARD_LEN) {
    p.money += GAJIAN;
    log(r, `💵 ${p.name} melewati Gajian, terima ${rp(GAJIAN)}.`);
  }
  p.pos = np;
}

function goBekasi(r, p) {
  p.pos = 8; p.inBekasi = true; p.attempts = 0;
  r.dbl = false; r.doubles = 0;
  log(r, `🚐 ${p.name} dipindahkan ke Bekasi.`);
}

function land(r, p, depth = 0) {
  const t = BOARD[p.pos];
  switch (t.type) {
    case 'prop': {
      const o = r.owner[t.i];
      if (o === undefined) {
        if (p.money < t.price) { log(r, `${p.name} mampir ke ${t.name} (${rp(t.price)}) tapi uangnya tidak cukup.`); return; }
        r.phase = 'buy'; r.pending = { tile: t.i };
        return;
      }
      if (o === p.id) return;
      const ow = byId(r, o);
      const rt = rentOf(r, t.i);
      log(r, `${p.name} mampir ke ${t.name} milik ${ow.name}, bayar ${rp(rt)}.`);
      pay(r, p, ow, rt);
      return;
    }
    case 'tax': log(r, `🧾 ${p.name} bayar pajak tahunan ${rp(t.amount)}.`); pay(r, p, null, t.amount); return;
    case 'tilang': log(r, `🚓 ${p.name} kena razia, tilang ${rp(t.amount)}.`); pay(r, p, null, t.amount); return;
    case 'pungli': log(r, `🤝 ${p.name} "kasih uang rokok" ke oknum ${rp(t.amount)}.`); pay(r, p, null, t.amount); return;
    case 'takdir': case 'musibah': drawCard(r, p, t.type, depth); return;
    case 'pemilu':
      if (rnd(2) === 0) { p.money += 600000; r.card = { kind: 'pemilu', text: 'Serangan fajar! Terima 600rb.', pid: p.id }; log(r, `🗳️ ${p.name} dapat serangan fajar ${rp(600000)}.`); }
      else { r.card = { kind: 'pemilu', text: 'Sumbangan kampanye wajib 400rb.', pid: p.id }; log(r, `🗳️ ${p.name} "menyumbang" kampanye ${rp(400000)}.`); pay(r, p, null, 400000); }
      return;
    case 'viral': log(r, `📱 ${p.name} digoreng netizen, akun dinonaktifkan.`); goBekasi(r, p); return;
    default: return;
  }
}

/* ------------------------------------------------------------------- kartu */
const gain = (n) => (r, p) => { p.money += n; };
const lose = (n) => (r, p) => { pay(r, p, null, n); };
const after = (r, p, d) => { if (!p.bankrupt && r.phase !== 'over' && d < 3) land(r, p, d + 1); };
const mv = (n) => (r, p, d) => { move(r, p, n); after(r, p, d); };
const toTile = (i) => (r, p, d) => { move(r, p, (i - p.pos + BOARD_LEN) % BOARD_LEN || BOARD_LEN); after(r, p, d); };
const fromAll = (n) => (r, p) => { for (const q of alive(r)) { if (q === p) continue; pay(r, q, p, n); if (r.phase === 'over') return; } };
const toAll = (n) => (r, p) => { for (const q of alive(r)) { if (q === p) continue; if (!pay(r, p, q, n)) return; } };
const repair = (base, per) => (r, p) => {
  const h = Object.keys(r.owner).filter((k) => r.owner[k] === p.id).reduce((s, k) => s + (r.houses[k] || 0), 0);
  const c = base + per * h;
  log(r, `Total biaya: ${rp(c)} (${h} rumah).`);
  pay(r, p, null, c);
};
const sengketa = (r, p) => {
  const c = Object.keys(r.owner).map(Number).filter((k) => r.owner[k] !== p.id && !(r.houses[k] > 0) && byId(r, r.owner[k]) && !byId(r, r.owner[k]).bankrupt);
  if (!c.length) { p.money += 300000; log(r, 'Tidak ada tanah yang bisa direbut. Dapat uang damai 300rb.'); return; }
  const k = c[rnd(c.length)];
  const lama = byId(r, r.owner[k]);
  r.owner[k] = p.id;
  log(r, `📜 Surat tanah ${BOARD[k].name} direbut dari ${lama.name}!`);
};
const sita = (r, p) => {
  const mine = Object.keys(r.owner).map(Number).filter((k) => r.owner[k] === p.id);
  if (!mine.length) { log(r, 'Tidak ada tanah untuk disita. Negara minta denda 500rb.'); pay(r, p, null, 500000); return; }
  const k = mine[rnd(mine.length)];
  delete r.owner[k]; delete r.houses[k];
  log(r, `🏗️ Negara menyita ${BOARD[k].name} untuk proyek strategis.`);
};

const CARDS = {
  takdir: [
    { text: 'Dapat THR dari kantor. Terima 1jt.', fx: gain(1000000) },
    { text: 'Cashback e-wallet cair. Terima 300rb.', fx: gain(300000) },
    { text: 'Warisan dari om yang tidak pernah kamu kenal. Terima 1,5jt.', fx: gain(1500000) },
    { text: 'Jualan online laris karena viral. Terima 800rb.', fx: gain(800000) },
    { text: 'Dapat bansos, dan kamu tidak menolak. Terima 500rb.', fx: gain(500000) },
    { text: 'Nemu uang di saku jaket lama. Terima 200rb.', fx: gain(200000) },
    { text: 'Maju ke Gajian.', fx: toTile(0) },
    { text: 'Ojol gratis ongkir, maju 3 petak.', fx: mv(3) },
    { text: 'Arisan jatuh ke kamu. Tiap pemain bayar 200rb.', fx: fromAll(200000) },
    { text: 'Hari ulang tahunmu. Tiap pemain kasih 150rb.', fx: fromAll(150000) },
    { text: 'Surat tanah sengketa: rebut satu tanah (tanpa rumah) milik pemain lain.', fx: sengketa },
    { text: 'Menang kuis berhadiah. Terima 600rb.', fx: gain(600000) },
    { text: 'Kenal "orang dalam". Simpan kartu ini untuk keluar dari Bekasi.', fx: (r, p) => { p.jailFree++; } },
    { text: 'Jadi buzzer sebulan. Terima 900rb.', fx: gain(900000) },
    { text: 'Naik gaji, cuma 2 persen. Terima 350rb.', fx: gain(350000) },
    { text: 'Tanggal merah! Langsung ke Libur Nasional.', fx: toTile(16) },
  ],
  musibah: [
    { text: 'Banjir bandang. Biaya perbaikan 400rb + 300rb per rumah.', fx: repair(400000, 300000) },
    { text: 'Digoreng netizen, akun dinonaktifkan. Pindah ke Bekasi.', fx: (r, p) => goBekasi(r, p) },
    { text: 'Motor digondol maling. Bayar 700rb.', fx: lose(700000) },
    { text: 'Kena tilang elektronik. Bayar 400rb.', fx: lose(400000) },
    { text: 'Pajak kendaraan naik. Bayar 600rb.', fx: lose(600000) },
    { text: 'Harga cabai naik, dompet menjerit. Bayar 300rb.', fx: lose(300000) },
    { text: 'Tanahmu disita negara untuk proyek strategis.', fx: sita },
    { text: 'Sakit, BPJS nunggak. Bayar 900rb.', fx: lose(900000) },
    { text: 'Pinjol menagih. Bayar 1jt.', fx: lose(1000000) },
    { text: 'Kena PHK massal. Bayar 300rb dan kehilangan 1 giliran.', fx: (r, p) => { p.skip++; pay(r, p, null, 300000); } },
    { text: 'Listrik padam, mundur 3 petak.', fx: mv(-3) },
    { text: 'Teman-temanmu nikah bareng. Kondangan 150rb ke tiap pemain.', fx: toAll(150000) },
    { text: 'Atap bocor kena gempa kecil. Biaya 200rb + 300rb per rumah.', fx: repair(200000, 300000) },
    { text: 'Ketipu investasi bodong. Bayar 1,2jt.', fx: lose(1200000) },
    { text: 'Gadget rusak kena banjir. Bayar 500rb.', fx: lose(500000) },
  ],
};

function drawCard(r, p, kind, depth) {
  const deck = r.decks[kind];
  if (!deck.length) { r.decks[kind] = shuffle([...CARDS[kind].keys()]); }
  const c = CARDS[kind][r.decks[kind].pop()];
  r.card = { kind, text: c.text, pid: p.id };
  log(r, `${kind === 'takdir' ? '🎴 Takdir' : '⚡ Musibah'} untuk ${p.name}: ${c.text}`);
  c.fx(r, p, depth);
}

/* ---------------------------------------------------------------- giliran */
function nextTurn(r) {
  if (checkWin(r)) return;
  const n = r.players.length;
  for (let k = 0; k < n * 3 + 2; k++) {
    r.turn = (r.turn + 1) % n;
    const p = r.players[r.turn];
    if (p.bankrupt) continue;
    if (p.skip > 0) { p.skip--; log(r, `⏭️ ${p.name} kehilangan giliran.`); continue; }
    break;
  }
  r.phase = 'roll'; r.pending = null; r.dbl = false; r.doubles = 0;
  setDeadline(r);
}

function settle(r, p) {
  if (r.phase === 'over') return;
  if (p.bankrupt) return nextTurn(r);
  if (r.phase === 'buy') { setDeadline(r); return; }
  r.phase = r.dbl && !p.inBekasi ? 'roll' : 'end';
  setDeadline(r);
}

function doRoll(r, p) {
  const a = 1 + rnd(6), b = 1 + rnd(6);
  r.dice = [a, b]; r.rollId++; r.card = null;
  const dbl = a === b;
  log(r, `🎲 ${p.name} melempar dadu: ${a} + ${b}.`);
  if (p.inBekasi) {
    if (dbl) {
      p.inBekasi = false; r.dbl = false;
      log(r, `${p.name} kabur dari Bekasi lewat dadu kembar!`);
      move(r, p, a + b); land(r, p); return settle(r, p);
    }
    p.attempts++;
    if (p.attempts >= 3) {
      p.inBekasi = false; r.dbl = false;
      log(r, `${p.name} sudah 3x gagal, bayar uang damai ${rp(TEBUS)} dan dilepas.`);
      if (!pay(r, p, null, TEBUS)) return settle(r, p);
      move(r, p, a + b); land(r, p); return settle(r, p);
    }
    log(r, `${p.name} gagal keluar dari Bekasi (${p.attempts}/3).`);
    r.dbl = false; r.phase = 'end'; setDeadline(r);
    return;
  }
  if (dbl) {
    r.doubles++;
    if (r.doubles >= 3) {
      log(r, `${p.name} kembar 3x berturut-turut, dicurigai dan digelandang ke Bekasi.`);
      goBekasi(r, p); return settle(r, p);
    }
    r.dbl = true;
  } else r.dbl = false;
  move(r, p, a + b);
  land(r, p);
  settle(r, p);
}

function canBuild(r, p, i) {
  const t = BOARD[i];
  if (!t || t.type !== 'prop') return false;
  if (r.owner[i] !== p.id) return false;
  if (!groupOwnedBy(r, t, p.id)) return false;
  const h = r.houses[i] || 0;
  if (h >= 3) return false;
  const other = BOARD.find((x) => x.group === t.group && x.i !== i);
  if (h > (r.houses[other.i] || 0)) return false;
  return p.money >= t.house;
}

function act(r, p, m) {
  if (!r || r.phase === 'lobby' || r.phase === 'over') return;
  const isTurn = cur(r) === p && !p.bankrupt;
  if (!isTurn) return;
  switch (m.t) {
    case 'roll':
      if (r.phase !== 'roll') return;
      doRoll(r, p); break;
    case 'buy': {
      if (r.phase !== 'buy' || !r.pending) return;
      const t = BOARD[r.pending.tile];
      if (p.money < t.price) return;
      p.money -= t.price; r.owner[t.i] = p.id; r.pending = null;
      log(r, `🏠 ${p.name} membeli ${t.name} seharga ${rp(t.price)}.`);
      r.phase = 'roll'; // keluar dari fase beli sebelum settle
      settle(r, p); break;
    }
    case 'skip':
      if (r.phase !== 'buy' || !r.pending) return;
      log(r, `${p.name} tidak membeli ${BOARD[r.pending.tile].name}.`);
      r.pending = null; r.phase = 'roll'; settle(r, p); break;
    case 'end':
      if (r.phase !== 'end') return;
      nextTurn(r); break;
    case 'leave':
      if (r.phase !== 'roll' || !p.inBekasi) return;
      if (m.how === 'card') {
        if (p.jailFree < 1) return;
        p.jailFree--; p.inBekasi = false;
        log(r, `${p.name} pakai kartu "orang dalam" dan bebas dari Bekasi.`);
      } else {
        if (p.money < TEBUS) return;
        p.money -= TEBUS; p.inBekasi = false;
        log(r, `${p.name} bayar uang damai ${rp(TEBUS)} dan keluar dari Bekasi.`);
      }
      setDeadline(r); break;
    case 'build': {
      if (r.phase !== 'roll' && r.phase !== 'end') return;
      const i = Number(m.tile);
      if (!Number.isInteger(i) || !canBuild(r, p, i)) return;
      p.money -= BOARD[i].house;
      r.houses[i] = (r.houses[i] || 0) + 1;
      log(r, `🔨 ${p.name} membangun rumah di ${BOARD[i].name} (level ${r.houses[i]}).`);
      break;
    }
    default: return;
  }
}

function autoPlay(r) {
  const p = cur(r);
  if (!p) return;
  if (r.phase === 'roll') { log(r, `⏱️ ${p.name} kelamaan, dadu dilempar otomatis.`); doRoll(r, p); }
  else if (r.phase === 'buy') { log(r, `⏱️ ${p.name} kelamaan, tidak jadi membeli.`); r.pending = null; r.phase = 'roll'; settle(r, p); }
  else if (r.phase === 'end') nextTurn(r);
}

/* ---------------------------------------------------------------- ruangan */
function view(r) {
  const c = cur(r);
  return {
    code: r.code, phase: r.phase, host: r.host,
    turn: r.phase === 'lobby' || !c ? null : c.id,
    players: r.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, money: p.money, pos: p.pos,
      connected: p.connected, bankrupt: p.bankrupt, inBekasi: p.inBekasi,
      jailFree: p.jailFree, skip: p.skip,
    })),
    owner: r.owner, houses: r.houses, dice: r.dice, rollId: r.rollId,
    pending: r.pending, card: r.card, winner: r.winner, dbl: r.dbl,
    log: r.log.slice(-60),
    left: r.phase === 'roll' || r.phase === 'buy' || r.phase === 'end' ? Math.max(0, Math.ceil((r.deadline - Date.now()) / 1000)) : 0,
  };
}
function send(ws, o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function broadcast(r) {
  const v = view(r);
  for (const p of r.players) if (p.connected) send(p.ws, { t: 'state', you: p.id, r: v });
}

function addPlayer(r, name, ws) {
  const used = new Set(r.players.map((p) => p.color));
  const p = {
    id: r.nextPid++, name, token: crypto.randomBytes(12).toString('hex'),
    color: PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0],
    ws, connected: true, drop: null,
  };
  resetPlayer(p);
  r.players.push(p);
  return p;
}

function removeLobbyPlayer(r, p) {
  r.players = r.players.filter((x) => x !== p);
  if (!r.players.length) { rooms.delete(r.code); return; }
  if (r.host === p.id) r.host = (r.players.find((x) => x.connected) || r.players[0]).id;
  broadcast(r);
}

function startGame(r) {
  r.phase = 'roll';
  r.turn = rnd(r.players.length);
  r.owner = {}; r.houses = {}; r.pending = null; r.card = null; r.winner = null;
  r.dice = [1, 1]; r.rollId = 0; r.dbl = false; r.doubles = 0;
  r.decks = { takdir: shuffle([...CARDS.takdir.keys()]), musibah: shuffle([...CARDS.musibah.keys()]) };
  r.players.forEach(resetPlayer);
  r.log = [];
  log(r, `🎮 Permainan dimulai! Bertahanlah sampai pemain terakhir. ${cur(r).name} jalan duluan.`);
  setDeadline(r);
}

function handle(ws, m) {
  if (!m || typeof m.t !== 'string') return;
  const ctx = ws.ctx;
  if (!ctx) {
    if (m.t === 'create') {
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', m: 'Server penuh, coba lagi nanti.' });
      const name = clean(m.name, 16);
      if (!name) return send(ws, { t: 'err', m: 'Isi nama dulu.' });
      const r = {
        code: newCode(), players: [], phase: 'lobby', turn: 0, owner: {}, houses: {}, dice: [1, 1], rollId: 0,
        pending: null, card: null, winner: null, dbl: false, doubles: 0, log: [], nextPid: 1, host: 0,
        decks: null, deadline: 0, active: Date.now(),
      };
      rooms.set(r.code, r);
      const p = addPlayer(r, name, ws);
      r.host = p.id;
      ws.ctx = { r, p };
      log(r, `${name} membuat ruangan.`);
      send(ws, { t: 'joined', token: p.token, code: r.code, you: p.id, board: BOARD, groups: GROUP_COLORS });
      broadcast(r);
    } else if (m.t === 'join') {
      const r = rooms.get(clean(m.room, 4).toUpperCase());
      const name = clean(m.name, 16);
      if (!r) return send(ws, { t: 'err', m: 'Kode ruangan tidak ditemukan.' });
      if (!name) return send(ws, { t: 'err', m: 'Isi nama dulu.' });
      if (r.phase !== 'lobby') return send(ws, { t: 'err', m: 'Permainan di ruangan ini sudah berjalan.' });
      if (r.players.length >= MAX_PLAYERS) return send(ws, { t: 'err', m: 'Ruangan penuh (maks 5 pemain).' });
      if (r.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return send(ws, { t: 'err', m: 'Nama itu sudah dipakai di ruangan ini.' });
      const p = addPlayer(r, name, ws);
      ws.ctx = { r, p };
      log(r, `${name} bergabung.`);
      send(ws, { t: 'joined', token: p.token, code: r.code, you: p.id, board: BOARD, groups: GROUP_COLORS });
      broadcast(r);
    } else if (m.t === 'rejoin') {
      const r = rooms.get(clean(m.room, 4).toUpperCase());
      const p = r && r.players.find((x) => x.token === m.token);
      if (!p) return send(ws, { t: 'err', m: 'Sesi tidak ditemukan.', fatal: true });
      if (p.ws && p.ws !== ws && p.ws.readyState === 1) { p.ws.ctx = null; p.ws.close(); }
      if (p.drop) { clearTimeout(p.drop); p.drop = null; }
      p.ws = ws; p.connected = true;
      ws.ctx = { r, p };
      send(ws, { t: 'joined', token: p.token, code: r.code, you: p.id, board: BOARD, groups: GROUP_COLORS });
      broadcast(r);
    }
    return;
  }

  const { r, p } = ctx;
  r.active = Date.now();
  const now = Date.now();
  if (ws.last && now - ws.last < MIN_GAP) return;
  ws.last = now;

  if (m.t === 'chat') {
    const x = clean(m.text, 140);
    if (!x) return;
    r.log.push({ w: p.name, c: p.color, x });
    if (r.log.length > 120) r.log.shift();
    return broadcast(r);
  }
  if (m.t === 'start') {
    if (r.phase !== 'lobby' || r.host !== p.id) return;
    r.players.filter((x) => !x.connected).forEach((x) => { if (x.drop) clearTimeout(x.drop); });
    r.players = r.players.filter((x) => x.connected);
    if (r.players.length < 2) return send(ws, { t: 'err', m: 'Minimal 2 pemain untuk mulai.' });
    startGame(r);
    return broadcast(r);
  }
  if (m.t === 'reset') {
    if (r.phase !== 'over' || r.host !== p.id) return;
    r.players = r.players.filter((x) => x.connected);
    r.players.forEach(resetPlayer);
    r.phase = 'lobby'; r.owner = {}; r.houses = {}; r.pending = null; r.card = null; r.winner = null;
    log(r, 'Kembali ke lobi.');
    return broadcast(r);
  }
  if (m.t === 'leave_room') {
    ws.ctx = null;
    if (r.phase === 'lobby') removeLobbyPlayer(r, p);
    else { p.connected = false; broadcast(r); }
    return send(ws, { t: 'left' });
  }
  act(r, p, m);
  broadcast(r);
}

/* ------------------------------------------------------------------ server */
const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(PUB, u));
  if (!f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.ctx = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch (e) { return; }
    try { handle(ws, m); } catch (e) { console.error('handler error', e); }
  });
  ws.on('close', () => {
    const ctx = ws.ctx;
    if (!ctx) return;
    const { r, p } = ctx;
    if (p.ws !== ws) return;
    p.connected = false;
    if (r.phase === 'lobby') {
      p.drop = setTimeout(() => { if (!p.connected && rooms.has(r.code)) removeLobbyPlayer(r, p); }, 30000);
    }
    broadcast(r);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if ((r.phase === 'roll' || r.phase === 'buy' || r.phase === 'end') && now > r.deadline) {
      try { autoPlay(r); } catch (e) { console.error('auto error', e); }
      broadcast(r);
    }
    if (r.players.every((p) => !p.connected) && now - r.active > 15 * 60000) rooms.delete(code);
  }
}, 1000);

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 25000);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Warga Survivor jalan di http://localhost:${PORT}`));
}
module.exports = { server };
