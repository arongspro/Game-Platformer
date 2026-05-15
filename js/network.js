// network.js - Firebase Realtime Database multiplayer

import { initializeApp, getApps }                                                        from 'firebase/app';
import { getDatabase, ref, set, onValue, remove, onDisconnect, get, child, update, serverTimestamp }
                                                                                         from 'firebase/database';
import { getAuth, onAuthStateChanged, signInAnonymously }                                from 'firebase/auth';

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyCHXYjHr67AHEj6cfUUn5jxGfKa3c5adYE',
  authDomain:        'multiplatformer-6db0f.firebaseapp.com',
  databaseURL:       'https://multiplatformer-6db0f-default-rtdb.europe-west1.firebasedatabase.app',
  projectId:         'multiplatformer-6db0f',
  storageBucket:     'multiplatformer-6db0f.firebasestorage.app',
  messagingSenderId: '74962223394',
  appId:             '1:74962223394:web:e4ab2a77d480a19474e57b',
};

const fireApp = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);

const posToObj = a => Array.isArray(a) ? { x: a[0]??0, y: a[1]??0, z: a[2]??0 } : a;
const posToArr = o => !o ? [0,0,0] : Array.isArray(o) ? o : [o.x??0, o.y??0, o.z??0];
const VALID_WEAPONS  = new Set(['rifle','sniper','pistol']);
const SEND_INTERVAL  = 50;
const STALE_TIMEOUT  = 10_000;
const MAX_CHAT_MSGS  = 50;

export class Network {
  constructor(userInfo) {
    this.db       = getDatabase(fireApp);
    this.auth     = getAuth(fireApp);
    this.myUid    = userInfo.uid || this.auth.currentUser?.uid || null;
    this.myId     = this.myUid;
    this.nickname = userInfo.nickname;
    this.pixels   = userInfo.pixels;

    this.otherPlayers = {};
    this.myHealth     = 100;
    this.roomId       = (localStorage.getItem('vp_room_id')   || 'PUBLIC').toUpperCase();
    this.roomName     = localStorage.getItem('vp_room_name')  || 'PUBLIC';
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
    this._targetHp           = {};
    this._lastSend           = 0;
    this._unsubs             = [];
    this._chatSince          = 0;

    this.onPlayersUpdate = null;
    this.onHealthUpdate  = null;
    this.onHit           = null;
    this.onKill          = null;
    this.onRoomUpdate    = null;
    this.onChat          = null;
    this.onExplosion     = null;  // (pos, type) => void

    if (this.myUid) {
      this._setupListeners();
    } else {
      console.warn('[Network] uid not ready, waiting for auth...');
      const unsub = onAuthStateChanged(this.auth, user => {
        unsub();
        if (user) {
          this.myUid = this.myId = user.uid;
          this._setupListeners();
        } else {
          signInAnonymously(this.auth)
            .then(({ user: u }) => { this.myUid = this.myId = u.uid; this._setupListeners(); })
            .catch(e => console.error('[Network] signInAnonymously failed:', e));
        }
      });
    }
  }

  _path(sub) { return `rooms/${this.roomId}/${sub}`; }

  _setupListeners() {
    this._clearListeners();
    this._chatSince = Date.now() - 100;

    const statePath = this._path('state');
    const metaPath  = this._path('meta');
    const chatPath  = this._path('chat');
    const hitsPath  = `hits/${this.myUid}`;

    this._ensureRoomMeta();

    // Players
    this._processedExplosions = this._processedExplosions || new Set();
    this._unsubs.push(onValue(ref(this.db, statePath), snap => {
      const data = snap.val() || {};
      const now  = Date.now();
      const others = {};
      for (const [uid, info] of Object.entries(data)) {
        if (uid === this.myUid) continue;
        if (info.ts && now - info.ts > STALE_TIMEOUT) continue;
        others[uid] = { ...info, pos: posToArr(info.pos) };
        if (info.health_reset) this._targetHp[uid] = 100;

        // 폭발 이벤트 처리 — lastExplosion.ts 기반으로 중복 방지
        const e = info.lastExplosion;
        if (e?.ts && now - e.ts < 3000) {
          const eKey = `${uid}_${e.ts}`;
          if (!this._processedExplosions.has(eKey)) {
            this._processedExplosions.add(eKey);
            this.onExplosion?.([e.x ?? 0, e.y ?? 0, e.z ?? 0], e.type || 'grenade');
          }
        }
      }
      this.otherPlayers = others;
      this.onPlayersUpdate?.(others);
    }));

    // Room meta
    this._unsubs.push(onValue(ref(this.db, metaPath), snap => {
      const m = snap.val() || {};
      this.roomName   = m.name   || this.roomName;
      this.matchLimit = Number(m.limit || this.matchLimit || 10);
      this.roomStatus = m.status || 'waiting';
      this.roomWinner = m.winner || null;
      this.roomHost   = m.host   || null;
      localStorage.setItem('vp_room_id',     this.roomId);
      localStorage.setItem('vp_room_name',   this.roomName);
      localStorage.setItem('vp_match_limit', String(this.matchLimit));
      this.onRoomUpdate?.({
        id: this.roomId, name: this.roomName, limit: this.matchLimit,
        status: this.roomStatus, winner: this.roomWinner, host: this.roomHost,
      });
    }));

    // Incoming hits
    // Bug fix: onValue fires on every DB change (incl. our own remove()), so the same
    // hit record appears in multiple snapshots before Firebase confirms deletion.
    // We track processed hit IDs in a Set to avoid applying damage twice.
    this._processedHits = new Set();
    this._unsubs.push(onValue(ref(this.db, hitsPath), snap => {
      const data = snap.val();
      if (!data) return;
      for (const [hitId, h] of Object.entries(data)) {
        if (this._processedHits.has(hitId)) continue;   // 이미 처리한 히트 무시
        this._processedHits.add(hitId);
        const itemRef = ref(this.db, `${hitsPath}/${hitId}`);
        if ((h.ts || 0) < this._respawnTime || this.isInvincible()) { remove(itemRef); continue; }
        this.myHealth = Math.max(0, this.myHealth - (h.damage || 15));
        this.onHealthUpdate?.(this.myHealth);
        this.onHit?.(h.damage || 15);
        remove(itemRef);
      }
    }));

    // Disconnect cleanup
    onDisconnect(ref(this.db, `players/${this.myUid}`)).remove();
    onDisconnect(ref(this.db, `${statePath}/${this.myUid}`)).remove();

    // Chat
    this._unsubs.push(onValue(ref(this.db, chatPath), snap => {
      if (!this.onChat) return;
      const data = snap.val() || {};
      const keys = Object.keys(data).sort();
      if (keys.length > MAX_CHAT_MSGS)
        keys.slice(0, keys.length - MAX_CHAT_MSGS)
            .filter(k => k.startsWith(this.myUid))   // 자기 메시지만 삭제 가능 (Firebase 규칙 준수)
            .forEach(k => remove(ref(this.db, `${chatPath}/${k}`)).catch(() => {}));
      Object.values(data)
        .filter(m => m?.ts > this._chatSince)
        .sort((a, b) => a.ts - b.ts)
        .forEach(m => { this._chatSince = Math.max(this._chatSince, m.ts); this.onChat(m); });
    }));
  }

  _clearListeners() {
    for (const u of this._unsubs || []) { try { u(); } catch (_) {} }
    this._unsubs = [];
  }

  _roomCode() { return Math.random().toString(36).slice(2, 6).toUpperCase(); }

  async _ensureRoomMeta() {
    const r    = ref(this.db, this._path('meta'));
    const snap = await get(r).catch(() => null);
    if (snap?.exists()) return;
    await set(r, {
      id: this.roomId, name: this.roomName || this.roomId,
      host: this.myUid, limit: this.matchLimit,
      status: 'waiting', createdAt: Date.now(), updatedAt: Date.now(),
    }).catch(() => {});
  }

  async createRoom(limit = 10) {
    const id = this._roomCode();
    await this.joinRoom(id, { name: id, limit, host: this.myUid, status: 'waiting', createdAt: Date.now(), updatedAt: Date.now() });
    return id;
  }

  async quickMatch(limit = 10) {
    const snap = await get(child(ref(this.db), 'rooms')).catch(() => null);
    const candidate = Object.values(snap?.val() || {})
      .map(r => r.meta)
      .filter(m => m?.id && m.status !== 'ended' && Number(m.limit || limit) === Number(limit))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .find(m => m.id !== this.roomId);
    return candidate
      ? this.joinRoom(String(candidate.id).trim().toUpperCase())
      : this.createRoom(limit);
  }

  async updateRoomLimit(limit = 10) {
    this.matchLimit = Number(limit) === 20 ? 20 : 10;
    localStorage.setItem('vp_match_limit', String(this.matchLimit));
    await update(ref(this.db, this._path('meta')), {
      limit: this.matchLimit,
      status: this.roomStatus === 'ended' ? 'waiting' : this.roomStatus,
      winner: null, updatedAt: Date.now(),
    }).catch(() => {});
  }

  async joinRoom(roomId, meta = null) {
    const nextRoom = String(roomId || '').trim().toUpperCase();
    if (!nextRoom) throw new Error('Room code is empty.');
    remove(ref(this.db, `players/${this.myUid}`)).catch(() => {});
    remove(ref(this.db, this._path(`state/${this.myUid}`))).catch(() => {});
    this.roomId = nextRoom;
    if (meta) {
      this.roomName   = meta.name || nextRoom;
      this.matchLimit = Number(meta.limit || this.matchLimit || 10);
      await set(ref(this.db, this._path('meta')), { id: this.roomId, ...meta, limit: this.matchLimit, updatedAt: Date.now() }).catch(() => {});
    } else {
      const snap = await get(child(ref(this.db), this._path('meta'))).catch(() => null);
      if (!snap?.exists())
        await set(ref(this.db, this._path('meta')), {
          id: this.roomId, name: nextRoom, host: this.myUid,
          limit: this.matchLimit, status: 'waiting', createdAt: Date.now(), updatedAt: Date.now(),
        }).catch(() => {});
    }
    localStorage.setItem('vp_room_id', this.roomId);
    this._respawnTime = Date.now();
    this._targetHp    = {};
    this.otherPlayers = {};
    this.kills  = 0;
    this.deaths = 0;
    this._processedExplosions = new Set();
    this._setupListeners();
  }

  sendUpdate(snapshot) {
    if (!this.myUid || !this._authReady()) return;
    const now = Date.now();
    if (now - this._lastSend < SEND_INTERVAL) return;
    this._lastSend = now;
    const pos = posToObj(snapshot.pos);
    set(ref(this.db, `players/${this.myUid}`), { pos, nickname: this.nickname, ts: serverTimestamp() })
      .catch(e => { if (e.code !== 'PERMISSION_DENIED') console.warn('[Network] sendUpdate/players:', e.message); });
    set(ref(this.db, this._path(`state/${this.myUid}`)), {
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
      grenades:    snapshot.grenades || [],
      rockets:     snapshot.rockets  || [],
      ts:          now,
    }).catch(e => { if (e.code !== 'PERMISSION_DENIED') console.warn('[Network] sendUpdate/state:', e.message); });
    update(ref(this.db, this._path('meta')), {
      updatedAt: now,
      status: this.roomStatus === 'ended' ? 'ended' : 'playing',
    }).catch(() => {});
  }

  sendHit(targetUid, damage = 15, weaponType = 'rifle') {
    if (!this.myUid) return;
    if (!this._authReady()) {
      // Auth 토큰이 아직 준비되지 않음 — 준비되면 재시도
      const unsub = onAuthStateChanged(this.auth, user => {
        unsub();
        if (user?.uid === this.myUid) this.sendHit(targetUid, damage, weaponType);
      });
      return;
    }
    this._targetHp[targetUid] ??= 100;
    this._targetHp[targetUid]  = Math.max(0, this._targetHp[targetUid] - damage);
    set(ref(this.db, `hits/${targetUid}/${this.myUid}_${Date.now()}`), {
      damage, weapon: VALID_WEAPONS.has(weaponType) ? weaponType : 'rifle', from: this.myUid, ts: Date.now(),
    }).catch(e => console.warn('[Network] sendHit failed:', e));
    if (this._targetHp[targetUid] <= 0) {
      this._targetHp[targetUid] = 100;
      this.confirmKill(targetUid);
    }
  }

  async confirmKill(targetUid) {
    this.kills++;
    this.totalKills++;
    this.rating += 25;
    await update(ref(this.db, `users/${this.nickname}`), { kills: this.totalKills, deaths: this.totalDeaths }).catch(() => {});
    if (this.kills >= this.matchLimit)
      update(ref(this.db, this._path('meta')), {
        status: 'ended', winner: this.myUid, endedAt: Date.now(), updatedAt: Date.now(),
      }).catch(() => {});
    this.onKill?.(targetUid, this.kills, this.deaths);
  }

  sendRespawn(posArr) {
    const now = Date.now();
    this.myHealth     = 100;
    this._respawnTime = now;
    this._processedHits = new Set();   // 리스폰 시 처리된 히트 목록 초기화
    this.deaths++;
    this.totalDeaths++;
    this.rating = Math.max(0, this.rating - 10);
    update(ref(this.db, `users/${this.nickname}`), { kills: this.totalKills, deaths: this.totalDeaths }).catch(() => {});
    remove(ref(this.db, `hits/${this.myUid}`)).catch(() => {});
    const pos = posToObj(posArr);
    set(ref(this.db, `players/${this.myUid}`),             { pos, nickname: this.nickname, ts: serverTimestamp() }).catch(() => {});
    set(ref(this.db, this._path(`state/${this.myUid}`)),   {
      pos, nickname: this.nickname, pixels: this.pixels,
      kills: this.kills, deaths: this.deaths, totalKills: this.totalKills,
      totalDeaths: this.totalDeaths, rating: this.rating, health_reset: true, ts: now,
    }).catch(() => {});
  }

  sendExplosion(posArr, type = 'grenade') {
    if (!this.myUid || !this._authReady()) return;
    // 기존 state 경로에 lastExplosion 필드를 update — 별도 경로 불필요
    update(ref(this.db, this._path(`state/${this.myUid}`)), {
      lastExplosion: { x: posArr[0], y: posArr[1], z: posArr[2], type, ts: Date.now() },
    }).catch(() => {});
  }

  sendChat(text) {
    if (!text || !this.myUid) return;
    if (!this._authReady()) {
      // Auth 토큰이 아직 준비되지 않음 — 준비되면 재시도 (sendHit과 동일한 패턴)
      const unsub = onAuthStateChanged(this.auth, user => {
        unsub();
        if (user?.uid === this.myUid) this.sendChat(text);
      });
      return;
    }
    set(ref(this.db, this._path(`chat/${this.myUid}_${Date.now()}`)), {
      uid: this.myUid, nickname: this.nickname, text: text.slice(0, 80), ts: Date.now(),
    }).catch(() => {});
  }

  listenChat(cb)   { this.onChat = cb; }
  disconnect()     { remove(ref(this.db, `players/${this.myUid}`)).catch(() => {}); remove(ref(this.db, this._path(`state/${this.myUid}`))).catch(() => {}); this._clearListeners(); }
  isInvincible()   { return Date.now() - this._respawnTime < this._invincibleDuration; }
  _authReady()     { return !!this.auth.currentUser && this.auth.currentUser.uid === this.myUid; }
  getPlayerCount() { return Object.keys(this.otherPlayers).length + 1; }
}
