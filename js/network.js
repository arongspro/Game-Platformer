// network.js - Firebase Realtime Database 멀티플레이어 (닉네임/픽셀/KD 포함)

import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, set, onValue, remove, onDisconnect, get, child, update }
  from 'firebase/database';

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
    this.myId     = userInfo.nickname;          // 닉네임을 ID로 사용
    this.nickname = userInfo.nickname;
    this.pixels   = userInfo.pixels;

    this.otherPlayers = {};
    this.myHealth     = 100;
    this.roomId       = localStorage.getItem('vp_room_id') || 'public';
    this.roomName     = localStorage.getItem('vp_room_name') || 'PUBLIC';
    this.matchLimit   = Number(localStorage.getItem('vp_match_limit') || 10);
    this.roomStatus   = 'waiting';
    this.roomWinner   = null;
    this.roomHost     = null;

    // 킬뎃
    this.totalKills  = userInfo.kills  || 0;
    this.totalDeaths = userInfo.deaths || 0;
    this.kills  = 0;
    this.deaths = 0;
    this.rating = userInfo.rating || 0;

    // 리스폰 무적
    this._respawnTime        = Date.now();
    this._invincibleDuration = 3000;

    this.onPlayersUpdate = null;
    this.onHealthUpdate  = null;
    this.onHit           = null;
    this.onKill          = null;   // 킬 발생 시 콜백
    this.onRoomUpdate    = null;

    this._lastSend    = 0;
    this._sendInterval = 50;

    this._unsubs = [];
    this._setupListeners();
  }

  _setupListeners() {
    this._clearListeners();
    const playersPath = `rooms/${this.roomId}/players`;
    const hitsPath = `rooms/${this.roomId}/hits/${this.myId}`;
    const metaPath = `rooms/${this.roomId}/meta`;

    this._ensureRoomMeta();

    // 전체 플레이어 구독
    this._unsubs.push(onValue(ref(this.db, playersPath), snapshot => {
      const data = snapshot.val() || {};
      const others = {};
      for (const [pid, info] of Object.entries(data)) {
        if (pid === this.myId) continue;
        if (info.ts && (Date.now() - info.ts > 3000)) continue;
        others[pid] = info;
      }
      // 타겟이 리스폰했으면 추적 HP 리셋
      if (!this._targetHp) this._targetHp = {};
      for (const [pid, info] of Object.entries(others)) {
        if (info.health_reset) {
          this._targetHp[pid] = 100;
        }
      }
      this.otherPlayers = others;
      if (this.onPlayersUpdate) this.onPlayersUpdate(others);
    }));

    this._unsubs.push(onValue(ref(this.db, metaPath), snapshot => {
      const meta = snapshot.val() || {};
      this.roomName = meta.name || this.roomName || this.roomId;
      this.matchLimit = Number(meta.limit || this.matchLimit || 10);
      this.roomStatus = meta.status || 'waiting';
      this.roomWinner = meta.winner || null;
      this.roomHost = meta.host || null;
      localStorage.setItem('vp_room_id', this.roomId);
      localStorage.setItem('vp_room_name', this.roomName);
      localStorage.setItem('vp_match_limit', String(this.matchLimit));
      if (this.onRoomUpdate) this.onRoomUpdate({
        id: this.roomId,
        name: this.roomName,
        limit: this.matchLimit,
        status: this.roomStatus,
        winner: this.roomWinner,
        host: this.roomHost,
      });
    }));

    // 피격 이벤트
    const hitRef = ref(this.db, hitsPath);
    this._unsubs.push(onValue(hitRef, snapshot => {
      const data = snapshot.val();
      if (!data) return;
      const hitTs = data.ts || 0;
      if (hitTs < this._respawnTime) { remove(hitRef); return; }
      if (Date.now() - this._respawnTime < this._invincibleDuration) { remove(hitRef); return; }

      this.myHealth = Math.max(0, this.myHealth - (data.damage || 15));
      if (this.onHealthUpdate) this.onHealthUpdate(this.myHealth);
      if (this.onHit) this.onHit(data.damage || 15);
      remove(hitRef);
    }));

    onDisconnect(ref(this.db, `${playersPath}/${this.myId}`)).remove();
  }

  _clearListeners() {
    for (const unsub of this._unsubs || []) {
      try { unsub(); } catch (_) {}
    }
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
      id: this.roomId,
      name: this.roomName || this.roomId,
      host: this.myId,
      limit: this.matchLimit,
      status: 'waiting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).catch(() => {});
  }

  async createRoom(limit = 10) {
    const roomId = this._roomCode();
    await this.joinRoom(roomId, {
      name: roomId,
      limit,
      host: this.myId,
      status: 'waiting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
      await this.joinRoom(room.id);
      return room.id;
    }
    return this.createRoom(limit);
  }

  async updateRoomLimit(limit = 10) {
    this.matchLimit = Number(limit) === 20 ? 20 : 10;
    localStorage.setItem('vp_match_limit', String(this.matchLimit));
    await update(ref(this.db, `rooms/${this.roomId}/meta`), {
      limit: this.matchLimit,
      status: this.roomStatus === 'ended' ? 'waiting' : this.roomStatus,
      winner: null,
      updatedAt: Date.now(),
    }).catch(() => {});
  }

  async joinRoom(roomId, meta = null) {
    const nextRoom = String(roomId || '').trim().toUpperCase();
    if (!nextRoom) throw new Error('방 코드가 비어 있습니다.');
    remove(ref(this.db, `rooms/${this.roomId}/players/${this.myId}`)).catch(() => {});
    remove(ref(this.db, `rooms/${this.roomId}/hits/${this.myId}`)).catch(() => {});
    this.roomId = nextRoom;
    if (meta) {
      this.roomName = meta.name || nextRoom;
      this.matchLimit = Number(meta.limit || this.matchLimit || 10);
      await set(ref(this.db, `rooms/${this.roomId}/meta`), {
        id: this.roomId,
        ...meta,
        limit: this.matchLimit,
        updatedAt: Date.now(),
      }).catch(() => {});
    } else {
      const snap = await get(child(ref(this.db), `rooms/${this.roomId}/meta`)).catch(() => null);
      if (!snap?.exists()) {
        await set(ref(this.db, `rooms/${this.roomId}/meta`), {
          id: this.roomId,
          name: nextRoom,
          host: this.myId,
          limit: this.matchLimit,
          status: 'waiting',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }).catch(() => {});
      }
    }
    localStorage.setItem('vp_room_id', this.roomId);
    this._respawnTime = Date.now();
    this._targetHp = {};
    this.otherPlayers = {};
    this.kills = 0;
    this.deaths = 0;
    this._setupListeners();
  }

  sendUpdate(snapshot) {
    const now = Date.now();
    if (now - this._lastSend < this._sendInterval) return;
    this._lastSend = now;
    set(ref(this.db, `rooms/${this.roomId}/players/${this.myId}`), {
      ...snapshot,
      nickname: this.nickname,
      pixels:   this.pixels,
      kills:    this.kills,
      deaths:   this.deaths,
      totalKills: this.totalKills,
      totalDeaths: this.totalDeaths,
      rating:   this.rating,
      ts:       now,
    }).catch(() => {});
    update(ref(this.db, `rooms/${this.roomId}/meta`), {
      updatedAt: now,
      status: this.roomStatus === 'ended' ? 'ended' : 'playing',
    }).catch(() => {});
  }

  sendHit(targetId, damage = 15) {
    // 타겟 HP 추적 (로컬에서)
    if (!this._targetHp) this._targetHp = {};
    if (this._targetHp[targetId] === undefined) this._targetHp[targetId] = 100;
    this._targetHp[targetId] = Math.max(0, this._targetHp[targetId] - damage);

    set(ref(this.db, `rooms/${this.roomId}/hits/${targetId}`), {
      damage,
      from: this.myId,
      ts:   Date.now()
    }).catch(() => {});

    // HP가 0 이하면 킬로 판정
    if (this._targetHp[targetId] <= 0) {
      this._targetHp[targetId] = 100; // 타겟 HP 리셋
      this.confirmKill(targetId);
    }
  }

  // 킬 확인: 타겟 HP가 0이 되면 킬 카운트 증가
  async confirmKill(targetId) {
    this.kills++;
    this.totalKills++;
    this.rating += 25;
    // DB에 킬 저장
    set(ref(this.db, `users/${this.myId}/kills`), this.totalKills).catch(()=>{});
    set(ref(this.db, `users/${this.myId}/rating`), this.rating).catch(()=>{});
    if (this.kills >= this.matchLimit) {
      update(ref(this.db, `rooms/${this.roomId}/meta`), {
        status: 'ended',
        winner: this.myId,
        endedAt: Date.now(),
        updatedAt: Date.now(),
      }).catch(() => {});
    }
    if (this.onKill) this.onKill(targetId, this.kills, this.deaths);
  }

  sendRespawn(posArr) {
    const now = Date.now();
    this.myHealth     = 100;
    this._respawnTime = now;
    this.deaths++;
    this.totalDeaths++;
    this.rating = Math.max(0, this.rating - 10);
    set(ref(this.db, `users/${this.myId}/deaths`), this.totalDeaths).catch(()=>{});
    set(ref(this.db, `users/${this.myId}/rating`), this.rating).catch(()=>{});
    remove(ref(this.db, `rooms/${this.roomId}/hits/${this.myId}`)).catch(() => {});
    set(ref(this.db, `rooms/${this.roomId}/players/${this.myId}`), {
      pos:          posArr,
      nickname:     this.nickname,
      pixels:       this.pixels,
      kills:        this.kills,
      deaths:       this.deaths,
      totalKills:   this.totalKills,
      totalDeaths:  this.totalDeaths,
      rating:       this.rating,
      health_reset: true,
      ts:           now
    }).catch(() => {});
  }

  disconnect() {
    remove(ref(this.db, `rooms/${this.roomId}/players/${this.myId}`)).catch(() => {});
    this._clearListeners();
  }

  isInvincible() {
    return (Date.now() - this._respawnTime) < this._invincibleDuration;
  }

  getPlayerCount() {
    return Object.keys(this.otherPlayers).length + 1;
  }
}
