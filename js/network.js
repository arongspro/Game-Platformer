// network.js - Firebase Realtime Database 멀티플레이어
// Firebase 규칙 호환: auth.uid 기반 경로, pos {x,y,z}, hits weapon 필드, users 일괄 update

import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, set, onValue, remove, onDisconnect, get, child, update }
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

    // auth.uid: Firebase 규칙 auth.uid === $uid 통과에 필수
    // auth.js의 ensureAuth()가 먼저 호출된 후 Network가 생성되어야 함
    this.myUid    = userInfo.uid || this.auth.currentUser?.uid;
    this.myId     = this.myUid;           // DB 경로 키로 uid 사용
    this.nickname = userInfo.nickname;
    this.pixels   = userInfo.pixels;

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

  // ── pos 배열 → 규칙 호환 객체 변환 ──
  // 규칙: pos.hasChildren(['x','y','z']) && pos/x, pos/y, pos/z isNumber()
  _posToObj(posArr) {
    if (Array.isArray(posArr)) {
      return { x: posArr[0] ?? 0, y: posArr[1] ?? 0, z: posArr[2] ?? 0 };
    }
    return posArr; // 이미 객체인 경우
  }

  // pos 객체 → 배열 (renderer 등 기존 코드 호환)
  _posToArr(posObj) {
    if (Array.isArray(posObj)) return posObj;
    return [posObj.x ?? 0, posObj.y ?? 0, posObj.z ?? 0];
  }

  _setupListeners() {
    this._clearListeners();
    const playersPath = `rooms/${this.roomId}/players`;
    const hitsPath    = `hits/${this.myUid}`;   // 규칙: hits/$victim_uid
    const metaPath    = `rooms/${this.roomId}/meta`;

    this._ensureRoomMeta();

    // 전체 플레이어 구독
    this._unsubs.push(onValue(ref(this.db, playersPath), snapshot => {
      const data = snapshot.val() || {};
      const others = {};
      for (const [pid, info] of Object.entries(data)) {
        if (pid === this.myUid) continue;
        if (info.ts && (Date.now() - info.ts > 3000)) continue;
        // pos 객체를 배열로 변환해 기존 renderer 코드 호환
        others[pid] = { ...info, pos: this._posToArr(info.pos) };
      }
      if (!this._targetHp) this._targetHp = {};
      for (const [pid, info] of Object.entries(others)) {
        if (info.health_reset) this._targetHp[pid] = 100;
      }
      this.otherPlayers = others;
      if (this.onPlayersUpdate) this.onPlayersUpdate(others);
    }));

    // 방 메타
    this._unsubs.push(onValue(ref(this.db, metaPath), snapshot => {
      const meta = snapshot.val() || {};
      this.roomName   = meta.name   || this.roomName || this.roomId;
      this.matchLimit = Number(meta.limit || this.matchLimit || 10);
      this.roomStatus = meta.status || 'waiting';
      this.roomWinner = meta.winner || null;
      this.roomHost   = meta.host   || null;
      localStorage.setItem('vp_room_id',    this.roomId);
      localStorage.setItem('vp_room_name',  this.roomName);
      localStorage.setItem('vp_match_limit', String(this.matchLimit));
      if (this.onRoomUpdate) this.onRoomUpdate({
        id: this.roomId, name: this.roomName, limit: this.matchLimit,
        status: this.roomStatus, winner: this.roomWinner, host: this.roomHost,
      });
    }));

    // 피격 이벤트 구독: hits/$myUid (규칙 호환 경로)
    // 규칙: $victim_uid 본인만 읽기 → auth.uid === myUid 이므로 통과
    const hitRef = ref(this.db, hitsPath);
    this._unsubs.push(onValue(hitRef, snapshot => {
      const data = snapshot.val();
      if (!data) return;

      // hits 하위에 hit_id 키들이 있을 수 있음 (규칙: hits/$victim/$hit_id)
      // 가장 최신 hit 하나씩 처리
      for (const [hitId, hitData] of Object.entries(data)) {
        const hitTs = hitData.ts || 0;
        const hitItemRef = ref(this.db, `${hitsPath}/${hitId}`);
        if (hitTs < this._respawnTime) { remove(hitItemRef); continue; }
        if (Date.now() - this._respawnTime < this._invincibleDuration) { remove(hitItemRef); continue; }

        this.myHealth = Math.max(0, this.myHealth - (hitData.damage || 15));
        if (this.onHealthUpdate) this.onHealthUpdate(this.myHealth);
        if (this.onHit) this.onHit(hitData.damage || 15);
        remove(hitItemRef);
      }
    }));

    onDisconnect(ref(this.db, `${playersPath}/${this.myUid}`)).remove();
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
      id:        this.roomId,
      name:      this.roomName || this.roomId,
      host:      this.myUid,
      limit:     this.matchLimit,
      status:    'waiting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
      limit:  this.matchLimit,
      status: this.roomStatus === 'ended' ? 'waiting' : this.roomStatus,
      winner: null,
      updatedAt: Date.now(),
    }).catch(() => {});
  }

  async joinRoom(roomId, meta = null) {
    const nextRoom = String(roomId || '').trim().toUpperCase();
    if (!nextRoom) throw new Error('방 코드가 비어 있습니다.');
    remove(ref(this.db, `rooms/${this.roomId}/players/${this.myUid}`)).catch(() => {});
    remove(ref(this.db, `hits/${this.myUid}`)).catch(() => {});
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

  // ── 위치 브로드캐스트 ──
  // 규칙: players/$uid 에 pos {x,y,z}, nickname, ts 필수
  sendUpdate(snapshot) {
    const now = Date.now();
    if (now - this._lastSend < this._sendInterval) return;
    this._lastSend = now;

    const rawPos = snapshot.pos;
    const pos = this._posToObj(rawPos);  // 배열 → {x,y,z} 변환

    set(ref(this.db, `rooms/${this.roomId}/players/${this.myUid}`), {
      ...snapshot,
      pos,                          // {x,y,z} 형식으로 덮어씀
      nickname:    this.nickname,
      pixels:      this.pixels,
      kills:       this.kills,
      deaths:      this.deaths,
      totalKills:  this.totalKills,
      totalDeaths: this.totalDeaths,
      rating:      this.rating,
      ts:          now,
    }).catch(() => {});

    update(ref(this.db, `rooms/${this.roomId}/meta`), {
      updatedAt: now,
      status: this.roomStatus === 'ended' ? 'ended' : 'playing',
    }).catch(() => {});
  }

  // ── 피격 전송 ──
  // 규칙: hits/$victim_uid/$hit_id 형식
  //       hit_id: /^[a-zA-Z0-9]+_[0-9]+$/
  //       weapon 필드 필수 (rifle|sniper|pistol)
  //       from: auth.uid, 자기 자신 공격 불가
  sendHit(targetUid, damage = 15, weaponType = 'rifle') {
    if (!this._targetHp) this._targetHp = {};
    if (this._targetHp[targetUid] === undefined) this._targetHp[targetUid] = 100;
    this._targetHp[targetUid] = Math.max(0, this._targetHp[targetUid] - damage);

    // 무기 화이트리스트 정규화
    const weapon = ['rifle', 'sniper', 'pistol'].includes(weaponType) ? weaponType : 'rifle';

    // hit_id: {uid일부}_{timestamp} 형식
    const hitId = `${this.myUid.slice(0, 8)}_${Date.now()}`;

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

    // 규칙: kills, deaths 동시에 update (따로 set 하면 validate 실패)
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

    // kills, deaths 함께 update (규칙: 두 필드 동시에 있어야 validate 통과)
    update(ref(this.db, `users/${this.nickname}`), {
      kills:  this.totalKills,
      deaths: this.totalDeaths,
    }).catch(() => {});

    remove(ref(this.db, `hits/${this.myUid}`)).catch(() => {});

    const pos = this._posToObj(posArr);
    set(ref(this.db, `rooms/${this.roomId}/players/${this.myUid}`), {
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
    remove(ref(this.db, `rooms/${this.roomId}/players/${this.myUid}`)).catch(() => {});
    this._clearListeners();
  }

  isInvincible() {
    return (Date.now() - this._respawnTime) < this._invincibleDuration;
  }

  getPlayerCount() {
    return Object.keys(this.otherPlayers).length + 1;
  }
}
