// network.js - Firebase Realtime Database 멀티플레이어
// 보안 경로(/players, /hits, /users)와 게임 데이터 경로(/rooms)를 분리

import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, set, onValue, remove, onDisconnect, get, child, update, serverTimestamp }
  from 'firebase/database';
import { getAuth } from 'firebase/auth';

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCHXYjHr67AHEj6cfUUn5jxGfKa3c5adYE",
  authDomain:        "multiplatformer-6db0f.firebaseapp.com",
  databaseURL:       "https://multiplatformer-6db0f-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "multiplatformer-6db0f",
  storageBucket:     "multiplatformer-6db0f.firebasestorage.app",
  messagingSenderId: "74962223394",
  appId:             "1:74962223394:web:e4ab2a77d480a19474e57b",
  measurementId:     "G-VDQ9ESN8L5"
};

const fireApp = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);

export class Network {
  constructor(userInfo) {
    this.db       = getDatabase(fireApp);
    this.auth     = getAuth(fireApp);
    this.myUid    = userInfo.uid || this.auth.currentUser?.uid;
    this.myId     = this.myUid;
    this.nickname = userInfo.nickname;
    this.pixels   = userInfo.pixels;

    if (!this.myUid) {
      console.error('[Network] UID 없음 - 인증이 완료되지 않았습니다.');
    }

    this.otherPlayers = {};
    this.myHealth     = 100;
    this.roomId       = (localStorage.getItem('vp_room_id') || 'PUBLIC').toUpperCase();
    this.roomName     = localStorage.getItem('vp_room_name') || 'PUBLIC';
    this.matchLimit   = Number(localStorage.getItem('vp_match_limit') || 10);
    this.roomStatus   = 'waiting';
    this.roomWinner   = null;
    this.roomHost     = null;

    this.totalKills  = userInfo.kills  || 0;
    this.totalDeaths = userInfo.deaths || 0;
    this.kills  = 0;
    this.deaths = 0;
    this.rating = userInfo.rating || 0;

    this._respawnTime        = Date.now();
    this._invincibleDuration = 3000;

    this.onPlayersUpdate = null;
    this.onHealthUpdate  = null;
    this.onHit           = null;
    this.onKill          = null;
    this.onRoomUpdate    = null;

    this._lastSend     = 0;
    this._sendInterval = 50;
    this._unsubs       = [];

    this._setupListeners();
  }

  // pos 배열 → {x,y,z} 객체 (규칙 호환)
  _posToObj(posArr) {
    if (Array.isArray(posArr)) return { x: posArr[0] ?? 0, y: posArr[1] ?? 0, z: posArr[2] ?? 0 };
    return posArr;
  }

  // pos 객체 → 배열 (renderer 호환)
  _posToArr(posObj) {
    if (!posObj) return [0, 0, 0];
    if (Array.isArray(posObj)) return posObj;
    return [posObj.x ?? 0, posObj.y ?? 0, posObj.z ?? 0];
  }

  _setupListeners() {
    this._clearListeners();

    // ── 경로 정의 ──
    // 보안 경로 (Firebase 규칙 적용)
    const securePlayerPath = `players/${this.myUid}`;
    // 게임 데이터 경로 (규칙 없음 - yaw/pitch/kills/pixels 등)
    const statePath  = `rooms/${this.roomId}/state`;
    const metaPath   = `rooms/${this.roomId}/meta`;
    const hitsPath   = `hits/${this.myUid}`;
    const chatPath   = `rooms/${this.roomId}/chat`;

    this._chatSince = Date.now() - 100; // 방 입장 시점 이후 메시지만

    this._ensureRoomMeta();

    // ── 플레이어 구독: state 경로에서 게임 데이터 수신 ──
    this._unsubs.push(onValue(ref(this.db, statePath), snapshot => {
      const data = snapshot.val() || {};
      const others = {};
      for (const [uid, info] of Object.entries(data)) {
        if (uid === this.myUid) continue;
        // 타임스탬프 없는 데이터도 허용 (ts 없으면 통과), 10초로 여유 확장
        if (info.ts && (Date.now() - info.ts > 10000)) continue;
        others[uid] = { ...info, pos: this._posToArr(info.pos) };
      }
      if (!this._targetHp) this._targetHp = {};
      for (const [uid, info] of Object.entries(others)) {
        if (info.health_reset) this._targetHp[uid] = 100;
      }
      this.otherPlayers = others;
      console.log(`[Network] 플레이어 수신: ${Object.keys(others).length}명`, Object.keys(others));
      if (this.onPlayersUpdate) this.onPlayersUpdate(others);
    }));

    // ── 방 메타 구독 ──
    this._unsubs.push(onValue(ref(this.db, metaPath), snapshot => {
      const meta = snapshot.val() || {};
      this.roomName   = meta.name   || this.roomName || this.roomId;
      this.matchLimit = Number(meta.limit || this.matchLimit || 10);
      this.roomStatus = meta.status || 'waiting';
      this.roomWinner = meta.winner || null;
      this.roomHost   = meta.host   || null;
      localStorage.setItem('vp_room_id',     this.roomId);
      localStorage.setItem('vp_room_name',   this.roomName);
      localStorage.setItem('vp_match_limit', String(this.matchLimit));
      if (this.onRoomUpdate) this.onRoomUpdate({
        id: this.roomId, name: this.roomName, limit: this.matchLimit,
        status: this.roomStatus, winner: this.roomWinner, host: this.roomHost,
      });
    }));

    // ── 피격 이벤트 구독: hits/$myUid ──
    const hitRef = ref(this.db, hitsPath);
    this._unsubs.push(onValue(hitRef, snapshot => {
      const data = snapshot.val();
      if (!data) return;
      for (const [hitId, hitData] of Object.entries(data)) {
        const hitItemRef = ref(this.db, `${hitsPath}/${hitId}`);
        const hitTs = hitData.ts || 0;
        if (hitTs < this._respawnTime)                                    { remove(hitItemRef); continue; }
        if (Date.now() - this._respawnTime < this._invincibleDuration)    { remove(hitItemRef); continue; }
        this.myHealth = Math.max(0, this.myHealth - (hitData.damage || 15));
        if (this.onHealthUpdate) this.onHealthUpdate(this.myHealth);
        if (this.onHit) this.onHit(hitData.damage || 15);
        remove(hitItemRef);
      }
    }));

    // 접속 끊기면 두 경로 모두 삭제
    onDisconnect(ref(this.db, securePlayerPath)).remove();
    onDisconnect(ref(this.db, `${statePath}/${this.myUid}`)).remove();

    // ── 채팅 구독 (방 입장 시점 이후 메시지만) ──
    this._unsubs.push(onValue(ref(this.db, chatPath), snapshot => {
      if (!this.onChat) return;
      const data = snapshot.val() || {};
      Object.values(data)
        .filter(m => m && m.ts > this._chatSince)
        .sort((a, b) => a.ts - b.ts)
        .forEach(m => {
          this._chatSince = Math.max(this._chatSince, m.ts); // 다음엔 이 이후만
          this.onChat(m);
        });
      // 50개 초과 시 오래된 것 정리
      const keys = Object.keys(data).sort();
      if (keys.length > 50) {
        keys.slice(0, keys.length - 50).forEach(k =>
          remove(ref(this.db, `${chatPath}/${k}`)).catch(() => {})
        );
      }
    }));
  }

  _clearListeners() {
    for (const unsub of this._unsubs || []) { try { unsub(); } catch (_) {} }
    this._unsubs = [];
  }

  _roomCode() {
    return Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  async _ensureRoomMeta() {
    const metaRef = ref(this.db, `rooms/${this.roomId}/meta`);
    const snap = await get(metaRef).catch(() => null);
    if (snap?.exists()) return;
    await set(metaRef, {
      id: this.roomId, name: this.roomName || this.roomId,
      host: this.myUid, limit: this.matchLimit,
      status: 'waiting', createdAt: Date.now(), updatedAt: Date.now(),
    }).catch(() => {});
  }

  async createRoom(limit = 10) {
    const roomId = this._roomCode();
    await this.joinRoom(roomId, {
      name: roomId, limit, host: this.myUid,
      status: 'waiting', createdAt: Date.now(), updatedAt: Date.now(),
    });
    return roomId;
  }

  async quickMatch(limit = 10) {
    const snap = await get(child(ref(this.db), 'rooms')).catch(() => null);
    const rooms = snap?.val() || {};
    const candidates = Object.values(rooms)
      .map(r => r.meta)
      .filter(meta => meta?.id && meta.status !== 'ended' && Number(meta.limit || limit) === Number(limit));
    candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const room = candidates.find(meta => meta.id !== this.roomId);
    if (room) {
      const rid = String(room.id).trim().toUpperCase();
      await this.joinRoom(rid);
      return rid;
    }
    return this.createRoom(limit);
  }

  async updateRoomLimit(limit = 10) {
    this.matchLimit = Number(limit) === 20 ? 20 : 10;
    localStorage.setItem('vp_match_limit', String(this.matchLimit));
    await update(ref(this.db, `rooms/${this.roomId}/meta`), {
      limit: this.matchLimit,
      status: this.roomStatus === 'ended' ? 'waiting' : this.roomStatus,
      winner: null, updatedAt: Date.now(),
    }).catch(() => {});
  }

  async joinRoom(roomId, meta = null) {
    const nextRoom = String(roomId || '').trim().toUpperCase();
    if (!nextRoom) throw new Error('방 코드가 비어 있습니다.');
    // 이전 방 데이터 삭제
    remove(ref(this.db, `players/${this.myUid}`)).catch(() => {});
    remove(ref(this.db, `rooms/${this.roomId}/state/${this.myUid}`)).catch(() => {});
    this.roomId = nextRoom;
    if (meta) {
      this.roomName   = meta.name || nextRoom;
      this.matchLimit = Number(meta.limit || this.matchLimit || 10);
      await set(ref(this.db, `rooms/${this.roomId}/meta`), {
        id: this.roomId, ...meta, limit: this.matchLimit, updatedAt: Date.now(),
      }).catch(() => {});
    } else {
      const snap = await get(child(ref(this.db), `rooms/${this.roomId}/meta`)).catch(() => null);
      if (!snap?.exists()) {
        await set(ref(this.db, `rooms/${this.roomId}/meta`), {
          id: this.roomId, name: nextRoom, host: this.myUid,
          limit: this.matchLimit, status: 'waiting',
          createdAt: Date.now(), updatedAt: Date.now(),
        }).catch(() => {});
      }
    }
    localStorage.setItem('vp_room_id', this.roomId);
    this._respawnTime = Date.now();
    this._targetHp    = {};
    this.otherPlayers = {};
    this.kills  = 0;
    this.deaths = 0;
    this._setupListeners();
  }

  // ── 위치 전송: 경로 2곳에 분리 저장 ──
  sendUpdate(snapshot) {
    if (!this.myUid) {
      console.warn('[Network] sendUpdate 스킵: myUid 없음');
      return;
    }
    const now = Date.now();
    if (now - this._lastSend < this._sendInterval) return;
    this._lastSend = now;

    const pos = this._posToObj(snapshot.pos);

    // 1) 보안 경로: pos + nickname + ts 만 (규칙 준수)
    set(ref(this.db, `players/${this.myUid}`), {
      pos,
      nickname: this.nickname,
      ts:       serverTimestamp(),
    }).catch(() => {});

    // 2) 게임 데이터 경로: 렌더링에 필요한 모든 데이터 (규칙 없음)
    set(ref(this.db, `rooms/${this.roomId}/state/${this.myUid}`), {
      pos,
      nickname:    this.nickname,
      pixels:      this.pixels,
      kills:       this.kills,
      deaths:      this.deaths,
      totalKills:  this.totalKills,
      totalDeaths: this.totalDeaths,
      rating:      this.rating,
      yaw:         snapshot.yaw,
      pitch:       snapshot.pitch,
      move_time:   snapshot.move_time,
      bob_amp:     snapshot.bob_amp,
      is_sliding:  snapshot.is_sliding,
      recoil:      snapshot.recoil,
      is_aiming:   snapshot.is_aiming,
      ts:          now,
    }).catch(() => {});

    update(ref(this.db, `rooms/${this.roomId}/meta`), {
      updatedAt: now,
      status: this.roomStatus === 'ended' ? 'ended' : 'playing',
    }).catch(() => {});
  }

  // ── 피격 전송: hits/$victim/$hitId (규칙 준수) ──
  sendHit(targetUid, damage = 15, weaponType = 'rifle') {
    if (!this._targetHp) this._targetHp = {};
    if (this._targetHp[targetUid] === undefined) this._targetHp[targetUid] = 100;
    this._targetHp[targetUid] = Math.max(0, this._targetHp[targetUid] - damage);

    const weapon = ['rifle', 'sniper', 'pistol'].includes(weaponType) ? weaponType : 'rifle';
    const hitId  = `${this.myUid}_${Date.now()}`;

    set(ref(this.db, `hits/${targetUid}/${hitId}`), {
      damage,
      weapon,
      from: this.myUid,
      ts:   Date.now(),
    }).catch(() => {});

    if (this._targetHp[targetUid] <= 0) {
      this._targetHp[targetUid] = 100;
      this.confirmKill(targetUid);
    }
  }

  async confirmKill(targetUid) {
    this.kills++;
    this.totalKills++;
    this.rating += 25;
    // kills + deaths 동시 update (규칙: 두 필드 함께 있어야 validate 통과)
    await update(ref(this.db, `users/${this.nickname}`), {
      kills:  this.totalKills,
      deaths: this.totalDeaths,
    }).catch(() => {});
    if (this.kills >= this.matchLimit) {
      update(ref(this.db, `rooms/${this.roomId}/meta`), {
        status: 'ended', winner: this.myUid,
        endedAt: Date.now(), updatedAt: Date.now(),
      }).catch(() => {});
    }
    if (this.onKill) this.onKill(targetUid, this.kills, this.deaths);
  }

  sendRespawn(posArr) {
    const now = Date.now();
    this.myHealth     = 100;
    this._respawnTime = now;
    this.deaths++;
    this.totalDeaths++;
    this.rating = Math.max(0, this.rating - 10);

    update(ref(this.db, `users/${this.nickname}`), {
      kills:  this.totalKills,
      deaths: this.totalDeaths,
    }).catch(() => {});

    remove(ref(this.db, `hits/${this.myUid}`)).catch(() => {});

    const pos = this._posToObj(posArr);

    // 보안 경로 업데이트
    set(ref(this.db, `players/${this.myUid}`), {
      pos, nickname: this.nickname, ts: serverTimestamp(),
    }).catch(() => {});

    // 게임 데이터 경로 업데이트
    set(ref(this.db, `rooms/${this.roomId}/state/${this.myUid}`), {
      pos,
      nickname:     this.nickname,
      pixels:       this.pixels,
      kills:        this.kills,
      deaths:       this.deaths,
      totalKills:   this.totalKills,
      totalDeaths:  this.totalDeaths,
      rating:       this.rating,
      health_reset: true,
      ts:           now,
    }).catch(() => {});
  }

  disconnect() {
    remove(ref(this.db, `players/${this.myUid}`)).catch(() => {});
    remove(ref(this.db, `rooms/${this.roomId}/state/${this.myUid}`)).catch(() => {});
    this._clearListeners();
  }

  isInvincible() {
    return (Date.now() - this._respawnTime) < this._invincibleDuration;
  }

  getPlayerCount() {
    return Object.keys(this.otherPlayers).length + 1;
  }

  // ── 채팅 ──
  sendChat(text) {
    if (!text || !this.myUid) return;
    // msgId = uid_timestamp 형식 → Firebase 규칙에서 uid 검증 가능
    const msgId = `${this.myUid}_${Date.now()}`;
    set(ref(this.db, `rooms/${this.roomId}/chat/${msgId}`), {
      uid:      this.myUid,
      nickname: this.nickname,
      text:     text.slice(0, 80),
      ts:       Date.now(),
    }).catch(() => {});
  }

  listenChat(callback) {
    this.onChat = callback;
  }
}
