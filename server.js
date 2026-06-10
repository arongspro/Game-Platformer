// server.js — Firebase 완전 대체 서버
// 역할: 회원 DB (SQLite) + 실시간 멀티플레이어 (Socket.IO)
//
// 설치:  npm install express socket.io better-sqlite3 cors
// 실행:  node server.js
// 포트:  3000 (HTTP + WebSocket 동시)

import express      from 'express';
import { createServer } from 'http';
import { Server }   from 'socket.io';
import Database     from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path         from 'path';
import cors         from 'cors';

// ── 경로 설정 ──────────────────────────────────────────────
const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH    = path.join(__dirname, 'game.db');
const STATIC_DIR = path.join(__dirname, '.');

// ── DB 초기화 ──────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    nickname   TEXT PRIMARY KEY,
    password   TEXT NOT NULL,
    pixels     TEXT NOT NULL DEFAULT '[]',
    kills      INTEGER NOT NULL DEFAULT 0,
    deaths     INTEGER NOT NULL DEFAULT 0,
    rating     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS platformer_scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname   TEXT NOT NULL,
    score      INTEGER NOT NULL DEFAULT 0,
    deaths     INTEGER NOT NULL DEFAULT 0,
    clear_time INTEGER NOT NULL DEFAULT 0,
    grade      TEXT NOT NULL DEFAULT 'D',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_pf_score ON platformer_scores(score DESC);
`);

// ── Prepared Statements ────────────────────────────────────
const stmtGetUser    = db.prepare('SELECT * FROM users WHERE nickname = ?');
const stmtInsertUser = db.prepare(`
  INSERT INTO users (nickname, password, pixels, kills, deaths, rating, created_at)
  VALUES (@nickname, @password, @pixels, 0, 0, 0, @createdAt)
`);
const stmtUpdateStats = db.prepare(`
  UPDATE users SET kills = @kills, deaths = @deaths, rating = @rating
  WHERE nickname = @nickname
`);

const stmtInsertPfScore = db.prepare(`
  INSERT INTO platformer_scores (nickname, score, deaths, clear_time, grade, created_at)
  VALUES (@nickname, @score, @deaths, @clearTime, @grade, @createdAt)
`);
const stmtGetPfRank = db.prepare(`
  SELECT nickname, score, deaths, clear_time, grade, created_at
  FROM platformer_scores
  ORDER BY score DESC
  LIMIT 20
`);
const stmtGetMyBest = db.prepare(`
  SELECT score, deaths, clear_time, grade
  FROM platformer_scores
  WHERE nickname = ?
  ORDER BY score DESC
  LIMIT 1
`);

// ── 비밀번호 해시 ─────────────────────────────────────────
function hashPassword(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) {
    h = ((h << 5) - h) + pw.charCodeAt(i);
    h |= 0;
  }
  return h.toString(16);
}

function pfGrade(s) {
  if (s >= 80000) return 'S';
  if (s >= 60000) return 'A';
  if (s >= 40000) return 'B';
  if (s >= 20000) return 'C';
  return 'D';
}

// ── Express 앱 ─────────────────────────────────────────────
const app    = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(STATIC_DIR));

// ── REST API: 회원가입 ─────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { nickname, password, pixels } = req.body || {};

  if (!nickname || nickname.length < 2)
    return res.status(400).json({ error: '닉네임은 2자 이상이어야 합니다.' });
  if (nickname.length > 12)
    return res.status(400).json({ error: '닉네임은 12자 이하여야 합니다.' });
  if (!/^[a-zA-Z0-9가-힣_\-]+$/.test(nickname))
    return res.status(400).json({ error: '닉네임에 허용되지 않는 문자가 있습니다.' });
  if (!password || password.length < 4)
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });

  if (stmtGetUser.get(nickname))
    return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });

  stmtInsertUser.run({
    nickname,
    password:  hashPassword(password),
    pixels:    JSON.stringify(pixels || []),
    createdAt: Date.now(),
  });

  return res.json({ nickname, pixels: pixels || [], kills: 0, deaths: 0, rating: 0 });
});

// ── REST API: 로그인 ───────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { nickname, password } = req.body || {};
  if (!nickname || !password)
    return res.status(400).json({ error: '닉네임과 비밀번호를 입력하세요.' });

  const row = stmtGetUser.get(nickname.trim());
  if (!row)
    return res.status(404).json({ error: '존재하지 않는 닉네임입니다.' });
  if (row.password !== hashPassword(password))
    return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });

  return res.json({
    nickname: row.nickname,
    pixels:   JSON.parse(row.pixels),
    kills:    row.kills,
    deaths:   row.deaths,
    rating:   row.rating,
  });
});

// ── REST API: 닉네임 변경 ──────────────────────────────────
app.post('/api/change-nickname', (req, res) => {
  const { nickname, password, newNickname } = req.body || {};
  if (!nickname || !password || !newNickname)
    return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
  if (newNickname.length < 2)  return res.status(400).json({ error: '닉네임은 2자 이상이어야 합니다.' });
  if (newNickname.length > 12) return res.status(400).json({ error: '닉네임은 12자 이하여야 합니다.' });
  if (!/^[a-zA-Z0-9가-힣_\-]+$/.test(newNickname))
    return res.status(400).json({ error: '닉네임에 허용되지 않는 문자가 있습니다.' });

  const row = stmtGetUser.get(nickname);
  if (!row)                                    return res.status(404).json({ error: '존재하지 않는 닉네임입니다.' });
  if (row.password !== hashPassword(password)) return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });
  if (stmtGetUser.get(newNickname))            return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });

  db.prepare(`
    INSERT INTO users (nickname, password, pixels, kills, deaths, rating, created_at)
    VALUES (@newNickname, @password, @pixels, @kills, @deaths, @rating, @created_at)
  `).run({ ...row, newNickname });
  db.prepare('DELETE FROM users WHERE nickname = ?').run(nickname);

  return res.json({ nickname: newNickname });
});

// ── REST API: 비밀번호 변경 ────────────────────────────────
app.post('/api/change-password', (req, res) => {
  const { nickname, currentPassword, newPassword } = req.body || {};
  if (!nickname || !currentPassword || !newPassword)
    return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
  if (newPassword.length < 4)
    return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다.' });

  const row = stmtGetUser.get(nickname);
  if (!row)                                           return res.status(404).json({ error: '존재하지 않는 닉네임입니다.' });
  if (row.password !== hashPassword(currentPassword)) return res.status(401).json({ error: '현재 비밀번호가 틀렸습니다.' });

  db.prepare('UPDATE users SET password = ? WHERE nickname = ?')
    .run(hashPassword(newPassword), nickname);

  return res.json({ ok: true });
});

// ── REST API: 픽셀 저장 ────────────────────────────────────
app.post('/api/save-pixels', (req, res) => {
  const { nickname, pixels } = req.body || {};
  if (!nickname || !pixels) return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });

  const row = stmtGetUser.get(nickname);
  if (!row) return res.status(404).json({ error: '존재하지 않는 닉네임입니다.' });

  db.prepare('UPDATE users SET pixels = ? WHERE nickname = ?')
    .run(JSON.stringify(pixels), nickname);

  return res.json({ ok: true });
});

// ── REST API: 유저 정보 조회 ───────────────────────────────
app.get('/api/user/ping_check', (_, res) => res.json({ ok: true }));

app.get('/api/user/:nickname', (req, res) => {
  const row = stmtGetUser.get(req.params.nickname);
  if (!row) return res.status(404).json({ error: '없는 유저' });
  const { password: _, ...safe } = row;
  safe.pixels = JSON.parse(safe.pixels);
  return res.json(safe);
});

// ── REST API: 플랫포머 기록 저장 ──────────────────────────
app.post('/api/platformer/score', (req, res) => {
  const { nickname, score, deaths, clearTime } = req.body || {};
  if (!nickname || score == null) return res.status(400).json({ error: '필수 항목 누락' });

  stmtInsertPfScore.run({
    nickname,
    score:     Number(score),
    deaths:    Number(deaths) || 0,
    clearTime: Number(clearTime) || 0,
    grade:     pfGrade(Number(score)),
    createdAt: Date.now(),
  });

  return res.json({ ok: true, grade: pfGrade(Number(score)) });
});

// ── REST API: 플랫포머 랭킹 조회 ─────────────────────────
app.get('/api/platformer/ranking', (req, res) => {
  return res.json(stmtGetPfRank.all());
});

// ── REST API: 플랫포머 개인 베스트 ───────────────────────
app.get('/api/platformer/best/:nickname', (req, res) => {
  const row = stmtGetMyBest.get(req.params.nickname);
  if (!row) return res.status(404).json({ error: '기록 없음' });
  return res.json(row);
});

// ── 인메모리 게임 상태 ─────────────────────────────────────
const rooms    = {};
const presence = {};
const hits     = {};
const duels    = { requests: {}, responses: {}, rooms: {} };

function ensureRoom(roomId) {
  if (!rooms[roomId]) rooms[roomId] = { meta: null, state: {} };
  return rooms[roomId];
}

// ── 플랫포머 무빙블록 ──────────────────────────────────────
const PF_ROOM = 'PLATFORMER';

// 클라이언트 MAP에서 정확히 추출한 블록 목록 (위→아래 순서)
// am=false : 자동 왕복 블록 (서버가 위치 계산 후 브로드캐스트)
// am=true  : 플레이어가 올라타야 움직이는 블록 (클라이언트가 직접 처리, 서버는 고정)
const pfBlocks = [
  { x:  350, y: 1350, inx:  350, iny: 1350, mx:  0, my:  4, ex:  10, ey: 100, am:false, movingWay:1, frame:0 },  // type=g
  { x:  550, y: 1350, inx:  550, iny: 1350, mx:  0, my:  4, ex:  10, ey: 100, am:false, movingWay:1, frame:0 },  // type=g
  { x:  750, y: 1350, inx:  750, iny: 1350, mx:  0, my:  4, ex:  10, ey: 100, am:false, movingWay:1, frame:0 },  // type=g
  { x:  950, y: 1350, inx:  950, iny: 1350, mx:  0, my:  4, ex:  10, ey: 100, am:false, movingWay:1, frame:0 },  // type=g
  { x: 1150, y: 1350, inx: 1150, iny: 1350, mx:  0, my:  4, ex:  10, ey: 100, am:false, movingWay:1, frame:0 },  // type=g
  { x:  450, y: 1450, inx:  450, iny: 1450, mx:  0, my: -4, ex:  10, ey: 100, am:false, movingWay:1, frame:0 },  // type=h
  { x:  650, y: 1450, inx:  650, iny: 1450, mx:  0, my: -4, ex:  10, ey: 100, am:false, movingWay:1, frame:0 },  // type=h
  { x:  850, y: 1450, inx:  850, iny: 1450, mx:  0, my: -4, ex:  10, ey: 100, am:false, movingWay:1, frame:0 },  // type=h
  { x: 1050, y: 1450, inx: 1050, iny: 1450, mx:  0, my: -4, ex:  10, ey: 100, am:false, movingWay:1, frame:0 },  // type=h
  { x:  300, y: 2050, inx:  300, iny: 2050, mx:  4, my:  0, ex: 250, ey:  10, am:false, movingWay:1, frame:0 },  // type=e
  { x:  850, y: 2050, inx:  850, iny: 2050, mx: -4, my:  0, ex: 250, ey:  10, am:false, movingWay:1, frame:0 },  // type=f
  { x:  900, y: 2050, inx:  900, iny: 2050, mx:  4, my:  0, ex: 250, ey:  10, am:false, movingWay:1, frame:0 },  // type=e
  { x: 1000, y: 2650, inx: 1000, iny: 2650, mx:  4, my:  0, ex:  50, ey:  10, am:true,  movingWay:1, frame:0 },  // type=c
  { x: 1350, y: 2650, inx: 1350, iny: 2650, mx:  0, my: -2, ex:  10, ey: 200, am:false, movingWay:1, frame:0 },  // type=a
  { x:  300, y: 2850, inx:  300, iny: 2850, mx:  4, my:  0, ex:  50, ey:  10, am:true,  movingWay:1, frame:0 },  // type=c
  { x:  650, y: 2850, inx:  650, iny: 2850, mx:  0, my: -2, ex:  10, ey: 200, am:true,  movingWay:1, frame:0 },  // type=d
  { x:  850, y: 3050, inx:  850, iny: 3050, mx:  0, my: -2, ex:  10, ey: 200, am:true,  movingWay:1, frame:0 },  // type=d
  { x:  900, y: 3250, inx:  900, iny: 3250, mx:  0, my: -2, ex:  10, ey: 200, am:true,  movingWay:1, frame:0 },  // type=d
  { x:  300, y: 3500, inx:  300, iny: 3500, mx:  4, my:  0, ex:  50, ey:  10, am:true,  movingWay:1, frame:0 },  // type=c
  { x:  500, y: 3600, inx:  500, iny: 3600, mx:  4, my:  0, ex: 250, ey:  10, am:true,  movingWay:1, frame:0 },  // type=b
  { x:   50, y: 3700, inx:   50, iny: 3700, mx:  0, my: -2, ex:  10, ey: 200, am:false, movingWay:1, frame:0 },  // type=a
  { x:  450, y: 4100, inx:  450, iny: 4100, mx:  4, my:  0, ex: 250, ey:  10, am:true,  movingWay:1, frame:0 },  // type=b
  { x:  850, y: 4100, inx:  850, iny: 4100, mx:  4, my:  0, ex: 250, ey:  10, am:true,  movingWay:1, frame:0 },  // type=b
  { x:  150, y: 4300, inx:  150, iny: 4300, mx:  0, my: -2, ex:  10, ey: 200, am:false, movingWay:1, frame:0 },  // type=a
];

// 클라이언트는 60fps(16.67ms)마다 1px씩 이동
// 서버 틱은 50ms → 한 틱당 3프레임치 이동해야 동일한 속도
const TICK_SCALE = 3;

function tickPfBlocks() {
  for (const b of pfBlocks) {
    // am=true: 플레이어가 올라타야 움직이는 블록 → 서버에서는 고정
    // 클라이언트가 플레이어 탑승 여부를 직접 감지해서 move() 처리함
    if (b.am) continue;

    // am=false: 자동 왕복 블록
    const a = Math.abs(b.x - b.inx) > b.ex && b.movingWay === 1;
    const bv = Math.abs(b.y - b.iny) > b.ey && b.movingWay === 1;
    const c = (b.mx > 0 && b.x < b.inx && b.movingWay === -1) || (b.mx < 0 && b.x > b.inx && b.movingWay === -1);
    const d = (b.my > 0 && b.y < b.iny && b.movingWay === -1) || (b.my < 0 && b.y > b.iny && b.movingWay === -1);
    if (a || bv || c || d) b.movingWay *= -1;
    b.x += b.mx * b.movingWay * TICK_SCALE;
    b.y += b.my * b.movingWay * TICK_SCALE;
    b.frame++;
  }
}

// 50ms마다 틱 + PLATFORMER 룸에 브로드캐스트
setInterval(() => {
  tickPfBlocks();
  const payload = pfBlocks.map(b => ({ x: b.x, y: b.y }));
  io.to(PF_ROOM).emit('blocks_update', payload);
}, 50);

// ── Socket.IO ──────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

const uidToSocket = {};

io.on('connection', socket => {
  let myUid      = null;
  let myNickname = null;
  let myRoomId   = null;

  socket.on('join', ({ uid, nickname, roomId, pixels, kills, deaths, rating }) => {
    myUid      = uid;
    myNickname = nickname;
    myRoomId   = (roomId || 'PUBLIC').toUpperCase();

    uidToSocket[uid] = socket.id;
    presence[uid] = { uid, nickname, ts: Date.now() };

    socket.join(myRoomId);
    const room = ensureRoom(myRoomId);

    if (!room.meta) {
      room.meta = {
        id: myRoomId, name: myRoomId, host: uid,
        limit: 10, status: 'waiting',
        createdAt: Date.now(), updatedAt: Date.now(),
      };
    }

    socket.on('disconnect', () => {
      delete presence[uid];
      delete uidToSocket[uid];
      if (rooms[myRoomId]) {
        delete rooms[myRoomId].state[uid];
        io.to(myRoomId).emit('state_update', rooms[myRoomId].state);
      }
      io.emit('presence_update', Object.values(presence));
    });

    socket.emit('room_meta', room.meta);
    io.emit('presence_update', Object.values(presence));
    socket.emit('state_update', room.state);

    // 플랫포머 룸 입장 시 현재 블록 위치 즉시 전송
    if (myRoomId === PF_ROOM) {
      socket.emit('blocks_update', pfBlocks.map(b => ({ x: b.x, y: b.y })));
    }

    if (hits[uid]?.length) {
      socket.emit('hits', hits[uid]);
      hits[uid] = [];
    }
  });

  socket.on('state_update', data => {
    if (!myUid || !myRoomId) return;
    const room = ensureRoom(myRoomId);
    room.state[myUid] = { ...data, ts: Date.now() };
    io.to(myRoomId).emit('state_update', room.state);
    if (room.meta) {
      room.meta.updatedAt = Date.now();
      if (room.meta.status !== 'ended') room.meta.status = 'playing';
    }
  });

  socket.on('room_meta_update', patch => {
    if (!myRoomId) return;
    const room = ensureRoom(myRoomId);
    room.meta  = { ...room.meta, ...patch, updatedAt: Date.now() };
    io.to(myRoomId).emit('room_meta', room.meta);
  });

  socket.on('change_room', ({ newRoomId, meta }) => {
    if (!myUid) return;

    if (myRoomId && rooms[myRoomId]) {
      delete rooms[myRoomId].state[myUid];
      io.to(myRoomId).emit('state_update', rooms[myRoomId].state);
    }
    socket.leave(myRoomId);

    myRoomId = (newRoomId || 'PUBLIC').toUpperCase();
    socket.join(myRoomId);

    const room = ensureRoom(myRoomId);
    if (meta && !room.meta) {
      room.meta = { id: myRoomId, ...meta, updatedAt: Date.now() };
    } else if (!room.meta) {
      room.meta = {
        id: myRoomId, name: myRoomId, host: myUid,
        limit: 10, status: 'waiting',
        createdAt: Date.now(), updatedAt: Date.now(),
      };
    }

    socket.emit('room_meta', room.meta);
    socket.emit('state_update', room.state);
  });

  socket.on('quick_match', ({ limit = 10 }, cb) => {
    const candidate = Object.values(rooms)
      .filter(r => r.meta && r.meta.status !== 'ended' && Number(r.meta.limit) === Number(limit) && r.meta.id !== myRoomId)
      .sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0))[0];

    const targetRoom = candidate
      ? candidate.meta.id
      : Math.random().toString(36).slice(2, 6).toUpperCase();

    cb({ roomId: targetRoom });
  });

  socket.on('send_hit', ({ targetUid, damage, weapon, from }) => {
    const hitObj = { damage, weapon, from, ts: Date.now(), id: `${from}_${Date.now()}` };
    const targetSid = uidToSocket[targetUid];
    if (targetSid) {
      io.to(targetSid).emit('hits', [hitObj]);
    } else {
      if (!hits[targetUid]) hits[targetUid] = [];
      hits[targetUid].push(hitObj);
    }
  });

  socket.on('update_stats', ({ nickname, kills, deaths, rating }) => {
    stmtUpdateStats.run({ kills, deaths, rating, nickname });
  });

  socket.on('chat', ({ text }) => {
    if (!myUid || !myRoomId || !text) return;
    io.to(myRoomId).emit('chat', {
      uid: myUid, nickname: myNickname,
      text: text.slice(0, 80), ts: Date.now(),
    });
  });

  socket.on('heartbeat', () => {
    if (!myUid) return;
    if (presence[myUid]) presence[myUid].ts = Date.now();
    const now = Date.now();
    for (const uid of Object.keys(presence)) {
      if (now - (presence[uid].ts || 0) > 90000) delete presence[uid];
    }
    io.emit('presence_update', Object.values(presence));
  });

  socket.on('duel_request', ({ targetUid, fromNick }) => {
    duels.requests[targetUid] = { fromUid: myUid, fromNick, ts: Date.now() };
    const targetSid = uidToSocket[targetUid];
    if (targetSid) io.to(targetSid).emit('duel_request', duels.requests[targetUid]);
  });

  socket.on('duel_accept', ({ toUid }) => {
    const roomId = `DUEL_${Date.now().toString(36).toUpperCase()}`;
    const payload = { status: 'accepted', roomId, ts: Date.now() };
    duels.responses[toUid] = payload;
    delete duels.requests[myUid];
    const toSid = uidToSocket[toUid];
    if (toSid) io.to(toSid).emit('duel_response', payload);
    socket.emit('duel_response_self', payload);
    duels.rooms[roomId] = { status: 'waiting', ready: {}, score: {}, rounds: {}, round: 1 };
  });

  socket.on('duel_decline', ({ toUid }) => {
    duels.responses[toUid] = { status: 'declined', ts: Date.now() };
    delete duels.requests[myUid];
    const toSid = uidToSocket[toUid];
    if (toSid) io.to(toSid).emit('duel_response', duels.responses[toUid]);
  });

  socket.on('duel_ready', ({ roomId, loadout }) => {
    if (!duels.rooms[roomId]) return;
    duels.rooms[roomId].ready[myUid] = { nickname: myNickname, loadout, ts: Date.now() };
    if (Object.keys(duels.rooms[roomId].ready).length >= 2) {
      duels.rooms[roomId].status  = 'active';
      duels.rooms[roomId].startTs = Date.now() + 500;
    } else {
      duels.rooms[roomId].status = 'waiting';
    }
    io.emit(`duel_room_${roomId}`, duels.rooms[roomId]);
  });

  socket.on('duel_kill', ({ roomId, killerNick }) => {
    if (!duels.rooms[roomId]) return;
    duels.rooms[roomId].score[myUid] = (duels.rooms[roomId].score[myUid] || 0) + 1;
    duels.rooms[roomId].lastKillNick = killerNick;
    const myScore = duels.rooms[roomId].score[myUid];
    if (myScore >= 5) {
      duels.rooms[roomId].status     = 'ended';
      duels.rooms[roomId].winnerNick = killerNick;
      duels.rooms[roomId].endedAt    = Date.now();
    }
    io.emit(`duel_room_${roomId}`, duels.rooms[roomId]);
  });

  socket.on('duel_end', ({ roomId, winnerNick }) => {
    if (!duels.rooms[roomId]) return;
    duels.rooms[roomId].status     = 'ended';
    duels.rooms[roomId].winnerNick = winnerNick;
    duels.rooms[roomId].endedAt    = Date.now();
    io.emit(`duel_room_${roomId}`, duels.rooms[roomId]);
  });

  socket.on('duel_score_listen', ({ roomId }) => {
    if (duels.rooms[roomId]) {
      socket.emit(`duel_room_${roomId}`, duels.rooms[roomId]);
    }
  });
});

// ══════════════════════════════════════════════════════════
// ── CHESS namespace (/chess) ───────────────────────────────
// ══════════════════════════════════════════════════════════
const chessIO = io.of('/chess');

const chessRooms = {};
const chessUidToSocket = {};

function ensureChessRoom(roomId) {
  if (!chessRooms[roomId]) {
    chessRooms[roomId] = {
      white: null, black: null,
      turn: 'w', mode: 'classic',
      status: 'waiting',
    };
  }
  return chessRooms[roomId];
}

chessIO.on('connection', socket => {
  let myUid    = null;
  let myRoomId = null;
  let myColor  = null;

  socket.on('chess_join', ({ uid, roomId, mode }) => {
    myUid    = uid;
    myRoomId = (roomId || '').toUpperCase().trim();
    if (!myRoomId) return socket.emit('chess_error', { msg: '방 코드가 없습니다.' });

    chessUidToSocket[uid] = socket.id;
    const room = ensureChessRoom(myRoomId);

    if (!room.white) {
      room.white = uid; myColor = 'white';
    } else if (!room.black && room.white !== uid) {
      room.black = uid; myColor = 'black';
      room.status = 'playing';
      if (mode) room.mode = mode;
    } else if (room.white === uid) {
      myColor = 'white';
    } else if (room.black === uid) {
      myColor = 'black';
    } else {
      return socket.emit('chess_error', { msg: '방이 꽉 찼습니다.' });
    }

    socket.join(myRoomId);
    socket.emit('chess_joined', { color: myColor, roomId: myRoomId, mode: room.mode, status: room.status });

    if (room.status === 'playing') {
      chessIO.to(myRoomId).emit('chess_start', { mode: room.mode });
    }
  });

  socket.on('chess_move', (moveData) => {
    if (!myRoomId) return;
    socket.to(myRoomId).emit('chess_move', moveData);
  });

  socket.on('chess_end', ({ result }) => {
    if (!myRoomId) return;
    const room = chessRooms[myRoomId];
    if (room) room.status = 'ended';
    chessIO.to(myRoomId).emit('chess_end', { result });
  });

  socket.on('chess_restart', () => {
    if (!myRoomId) return;
    const room = chessRooms[myRoomId];
    if (!room) return;
    room.status = 'playing';
    room.turn   = 'w';
    chessIO.to(myRoomId).emit('chess_restart');
  });

  socket.on('chess_chat', ({ text }) => {
    if (!myRoomId || !text) return;
    chessIO.to(myRoomId).emit('chess_chat', {
      color: myColor,
      text: text.slice(0, 80),
      ts: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    if (!myUid) return;
    delete chessUidToSocket[myUid];
    if (myRoomId && chessRooms[myRoomId]) {
      socket.to(myRoomId).emit('chess_opponent_left');
      const room = chessRooms[myRoomId];
      if (room.white === myUid) room.white = null;
      if (room.black === myUid) room.black = null;
      if (!room.white && !room.black) delete chessRooms[myRoomId];
    }
  });
});

// ── 서버 시작 ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중: http://0.0.0.0:${PORT}`);
  console.log(`   DB: ${DB_PATH}`);
});
