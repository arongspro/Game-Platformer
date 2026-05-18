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
const STATIC_DIR = path.join(__dirname, '.');   // index.html 등이 있는 폴더

// ── DB 초기화 ──────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');  // 동시 읽기/쓰기 성능 향상

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

// ── 비밀번호 해시 (auth.js 와 동일한 로직) ────────────────
function hashPassword(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) {
    h = ((h << 5) - h) + pw.charCodeAt(i);
    h |= 0;
  }
  return h.toString(16);
}

// ── Express 앱 ─────────────────────────────────────────────
const app    = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(STATIC_DIR));  // 게임 파일 정적 제공

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

  return res.json({
    nickname,
    pixels: pixels || [],
    kills: 0, deaths: 0, rating: 0,
  });
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
  if (!row)                                  return res.status(404).json({ error: '존재하지 않는 닉네임입니다.' });
  if (row.password !== hashPassword(password)) return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });
  if (stmtGetUser.get(newNickname))          return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });

  // 기존 데이터를 새 닉네임으로 복사 후 원본 삭제
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
  if (!row)                                       return res.status(404).json({ error: '존재하지 않는 닉네임입니다.' });
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
app.get('/api/user/:nickname', (req, res) => {
  const row = stmtGetUser.get(req.params.nickname);
  if (!row) return res.status(404).json({ error: '없는 유저' });
  const { password: _, ...safe } = row;  // 비밀번호 제외
  safe.pixels = JSON.parse(safe.pixels);
  return res.json(safe);
});

// ── 인메모리 게임 상태 ─────────────────────────────────────
// rooms[roomId] = { meta: {...}, state: { uid: playerData } }
// presence[uid] = { nickname, uid, ts }
// hits[uid]     = [ { damage, from, weapon, ts, id } ]
// duels.requests[uid] = { fromUid, fromNick, ts }
// duels.responses[uid] = { status, roomId, ts }
// duels.rooms[roomId]  = { status, ready: {}, score: {}, ... }

const rooms    = {};   // roomId → { meta, state }
const presence = {};   // uid → { nickname, uid, ts }
const hits     = {};   // targetUid → [ hitObj ]
const duels    = { requests: {}, responses: {}, rooms: {} };

function ensureRoom(roomId) {
  if (!rooms[roomId]) rooms[roomId] = { meta: null, state: {} };
  return rooms[roomId];
}

// ── Socket.IO ──────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

// uid → socket.id 역매핑 (한 uid = 한 소켓 가정)
const uidToSocket = {};

io.on('connection', socket => {
  let myUid      = null;
  let myNickname = null;
  let myRoomId   = null;

  // ── 입장 ──────────────────────────────────────────────
  socket.on('join', ({ uid, nickname, roomId, pixels, kills, deaths, rating }) => {
    myUid      = uid;
    myNickname = nickname;
    myRoomId   = (roomId || 'PUBLIC').toUpperCase();

    uidToSocket[uid] = socket.id;

    // 프레전스 등록
    presence[uid] = { uid, nickname, ts: Date.now() };

    // 룸 참여
    socket.join(myRoomId);
    const room = ensureRoom(myRoomId);

    // 룸 메타 없으면 생성
    if (!room.meta) {
      room.meta = {
        id: myRoomId, name: myRoomId, host: uid,
        limit: 10, status: 'waiting',
        createdAt: Date.now(), updatedAt: Date.now(),
      };
    }

    // 소켓 끊기면 자동 제거
    socket.on('disconnect', () => {
      delete presence[uid];
      delete uidToSocket[uid];
      if (rooms[myRoomId]) {
        delete rooms[myRoomId].state[uid];
        io.to(myRoomId).emit('state_update', rooms[myRoomId].state);
      }
      io.emit('presence_update', Object.values(presence));
    });

    // 현재 룸 메타 전송
    socket.emit('room_meta', room.meta);

    // 현재 presence 전송
    io.emit('presence_update', Object.values(presence));

    // 현재 state 전송
    socket.emit('state_update', room.state);

    // 쌓여있는 hits 전송
    if (hits[uid]?.length) {
      socket.emit('hits', hits[uid]);
      hits[uid] = [];
    }
  });

  // ── 위치/상태 업데이트 ────────────────────────────────
  socket.on('state_update', data => {
    if (!myUid || !myRoomId) return;
    const room = ensureRoom(myRoomId);
    room.state[myUid] = { ...data, ts: Date.now() };
    // 룸 내 모든 플레이어에게 브로드캐스트 (발신자 포함)
    io.to(myRoomId).emit('state_update', room.state);
    // 룸 메타 updatedAt 갱신
    if (room.meta) {
      room.meta.updatedAt = Date.now();
      if (room.meta.status !== 'ended') room.meta.status = 'playing';
    }
  });

  // ── 방 메타 업데이트 ──────────────────────────────────
  socket.on('room_meta_update', patch => {
    if (!myRoomId) return;
    const room = ensureRoom(myRoomId);
    room.meta  = { ...room.meta, ...patch, updatedAt: Date.now() };
    io.to(myRoomId).emit('room_meta', room.meta);
  });

  // ── 룸 변경 ───────────────────────────────────────────
  socket.on('change_room', ({ newRoomId, meta }) => {
    if (!myUid) return;

    // 기존 룸 state 에서 제거
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

  // ── 퀵매치 ────────────────────────────────────────────
  socket.on('quick_match', ({ limit = 10 }, cb) => {
    const candidate = Object.values(rooms)
      .filter(r => r.meta && r.meta.status !== 'ended' && Number(r.meta.limit) === Number(limit) && r.meta.id !== myRoomId)
      .sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0))[0];

    const targetRoom = candidate
      ? candidate.meta.id
      : Math.random().toString(36).slice(2, 6).toUpperCase();

    cb({ roomId: targetRoom });
  });

  // ── 히트 전송 ─────────────────────────────────────────
  socket.on('send_hit', ({ targetUid, damage, weapon, from }) => {
    const hitObj = { damage, weapon, from, ts: Date.now(), id: `${from}_${Date.now()}` };
    const targetSid = uidToSocket[targetUid];
    if (targetSid) {
      // 상대가 온라인이면 바로 전송
      io.to(targetSid).emit('hits', [hitObj]);
    } else {
      // 오프라인이면 큐에 보관
      if (!hits[targetUid]) hits[targetUid] = [];
      hits[targetUid].push(hitObj);
    }
  });

  // ── 통계 업데이트 ─────────────────────────────────────
  socket.on('update_stats', ({ nickname, kills, deaths, rating }) => {
    stmtUpdateStats.run({ kills, deaths, rating, nickname });
  });

  // ── 채팅 ──────────────────────────────────────────────
  socket.on('chat', ({ text }) => {
    if (!myUid || !myRoomId || !text) return;
    io.to(myRoomId).emit('chat', {
      uid: myUid, nickname: myNickname,
      text: text.slice(0, 80), ts: Date.now(),
    });
  });

  // ── 프레전스 heartbeat ────────────────────────────────
  socket.on('heartbeat', () => {
    if (!myUid) return;
    if (presence[myUid]) presence[myUid].ts = Date.now();
    // 90초 이상 오래된 presence 정리
    const now = Date.now();
    for (const uid of Object.keys(presence)) {
      if (now - (presence[uid].ts || 0) > 90000) delete presence[uid];
    }
    io.emit('presence_update', Object.values(presence));
  });

  // ── 결투 요청 ─────────────────────────────────────────
  socket.on('duel_request', ({ targetUid, fromNick }) => {
    duels.requests[targetUid] = { fromUid: myUid, fromNick, ts: Date.now() };
    const targetSid = uidToSocket[targetUid];
    if (targetSid) io.to(targetSid).emit('duel_request', duels.requests[targetUid]);
  });

  socket.on('duel_accept', ({ toUid }) => {
    const roomId = `DUEL_${Date.now().toString(36).toUpperCase()}`;
    duels.responses[toUid] = { status: 'accepted', roomId, ts: Date.now() };
    delete duels.requests[myUid];
    const toSid = uidToSocket[toUid];
    if (toSid) io.to(toSid).emit('duel_response', duels.responses[toUid]);
    duels.rooms[roomId] = { status: 'waiting', ready: {}, score: {} };
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
    io.emit(`duel_room_${roomId}`, duels.rooms[roomId]);
  });

  socket.on('duel_end', ({ roomId, winnerNick }) => {
    if (!duels.rooms[roomId]) return;
    duels.rooms[roomId].status    = 'ended';
    duels.rooms[roomId].winnerNick = winnerNick;
    duels.rooms[roomId].endedAt   = Date.now();
    io.emit(`duel_room_${roomId}`, duels.rooms[roomId]);
  });

  socket.on('duel_score_listen', ({ roomId }) => {
    // 클라이언트가 구독 요청 → 현재 값 즉시 전송
    if (duels.rooms[roomId]) {
      socket.emit(`duel_room_${roomId}`, duels.rooms[roomId]);
    }
  });
});

// ── 서버 시작 ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중: http://0.0.0.0:${PORT}`);
  console.log(`   DB: ${DB_PATH}`);
});
