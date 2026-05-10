// network.js - Firebase Realtime Database 멀티플레이어

import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, set, onValue, remove, onDisconnect } from 'firebase/database';

// ⚠️ 아래 __값__ 들은 GitHub Actions가 자동으로 채워줍니다. 직접 수정하지 마세요!
const FIREBASE_CONFIG = {
  apiKey:            "__VITE_FB_API_KEY__",
  authDomain:        "__VITE_FB_AUTH_DOMAIN__",
  databaseURL:       "__VITE_FB_DATABASE_URL__",
  projectId:         "__VITE_FB_PROJECT_ID__",
  storageBucket:     "__VITE_FB_STORAGE_BUCKET__",
  messagingSenderId: "__VITE_FB_MESSAGING_SENDER_ID__",
  appId:             "__VITE_FB_APP_ID__",
  measurementId:     "__VITE_FB_MEASUREMENT_ID__"
};

if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith("__")) {
  console.warn("⚠️ Firebase 환경 변수가 주입되지 않았습니다. GitHub Actions 로그를 확인하세요.");
}

const fireApp = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);

export class Network {
  constructor(userInfo) {
    this.db       = getDatabase(fireApp);
    this.myId     = userInfo.nickname;
    this.nickname = userInfo.nickname;
    this.pixels   = userInfo.pixels;

    this.otherPlayers = {};
    this.myHealth     = 100;

    this.kills  = userInfo.kills  || 0;
    this.deaths = userInfo.deaths || 0;

    this._respawnTime        = Date.now();
    this._invincibleDuration = 3000;

    this.onPlayersUpdate = null;
    this.onHealthUpdate  = null;
    this.onHit           = null;
    this.onKill          = null;

    this._lastSend     = 0;
    this._sendInterval = 50;

    this._setupListeners();
  }

  _setupListeners() {
    onValue(ref(this.db, 'players'), snapshot => {
      const data = snapshot.val() || {};
      const others = {};
      for (const [pid, info] of Object.entries(data)) {
        if (pid === this.myId) continue;
        if (info.ts && (Date.now() - info.ts > 3000)) continue;
        others[pid] = info;
      }

      if (!this._targetHp) this._targetHp = {};
      for (const [pid, info] of Object.entries(others)) {
        if (info.health_reset) {
          this._targetHp[pid] = 100;
        }
      }
      this.otherPlayers = others;
      if (this.onPlayersUpdate) this.onPlayersUpdate(others);
    });

    const hitRef = ref(this.db, `hits/${this.myId}`);
    onValue(hitRef, snapshot => {
      const data = snapshot.val();
      if (!data) return;
      const hitTs = data.ts || 0;
      if (hitTs < this._respawnTime) { remove(hitRef); return; }
      if (Date.now() - this._respawnTime < this._invincibleDuration) { remove(hitRef); return; }

      this.myHealth = Math.max(0, this.myHealth - (data.damage || 15));
      if (this.onHealthUpdate) this.onHealthUpdate(this.myHealth);
      if (this.onHit) this.onHit(data.damage || 15);
      remove(hitRef);
    });

    onDisconnect(ref(this.db, `players/${this.myId}`)).remove();
  }

  sendUpdate(snapshot) {
    const now = Date.now();
    if (now - this._lastSend < this._sendInterval) return;
    this._lastSend = now;
    set(ref(this.db, `players/${this.myId}`), {
      ...snapshot,
      nickname: this.nickname,
      pixels:   this.pixels,
      kills:    this.kills,
      deaths:   this.deaths,
      ts:       now,
    }).catch(() => {});
  }

  sendHit(targetId, damage = 15) {
    if (!this._targetHp) this._targetHp = {};
    if (this._targetHp[targetId] === undefined) this._targetHp[targetId] = 100;
    this._targetHp[targetId] = Math.max(0, this._targetHp[targetId] - damage);

    set(ref(this.db, `hits/${targetId}`), {
      damage,
      from: this.myId,
      ts:   Date.now()
    }).catch(() => {});

    if (this._targetHp[targetId] <= 0) {
      this._targetHp[targetId] = 100;
      this.confirmKill(targetId);
    }
  }

  async confirmKill(targetId) {
    this.kills++;
    set(ref(this.db, `users/${this.myId}/kills`), this.kills).catch(() => {});
    if (this.onKill) this.onKill(targetId, this.kills, this.deaths);
  }

  sendRespawn(posArr) {
    const now = Date.now();
    this.myHealth     = 100;
    this._respawnTime = now;
    this.deaths++;
    set(ref(this.db, `users/${this.myId}/deaths`), this.deaths).catch(() => {});
    remove(ref(this.db, `hits/${this.myId}`)).catch(() => {});
    set(ref(this.db, `players/${this.myId}`), {
      pos:          posArr,
      nickname:     this.nickname,
      pixels:       this.pixels,
      health_reset: true,
      ts:           now
    }).catch(() => {});
  }

  disconnect() {
    remove(ref(this.db, `players/${this.myId}`)).catch(() => {});
  }

  isInvincible() {
    return (Date.now() - this._respawnTime) < this._invincibleDuration;
  }

  getPlayerCount() {
    return Object.keys(this.otherPlayers).length + 1;
  }
}
