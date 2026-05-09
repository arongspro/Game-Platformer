// network.js - Firebase Realtime Database 멀티플레이어

import { initializeApp }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, set, onValue, remove, onDisconnect }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

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

export class Network {
  constructor() {
    this.app = initializeApp(FIREBASE_CONFIG);
    this.db  = getDatabase(this.app);
    this.myId = 'player_' + Math.random().toString(36).slice(2, 9);

    this.otherPlayers = {};
    this.myHealth     = 100;

    // 리스폰 무적 시간 관리
    // 이 시각 이전에 날아온 hit는 무시
    this._respawnTime = Date.now();
    // 리스폰 후 무적 시간 (ms) - 3초
    this._invincibleDuration = 3000;

    this.onPlayersUpdate = null;
    this.onHealthUpdate  = null;
    this.onHit           = null;

    this._lastSend    = 0;
    this._sendInterval = 50; // 20hz

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
      this.otherPlayers = others;
      if (this.onPlayersUpdate) this.onPlayersUpdate(others);
    });

    const hitRef = ref(this.db, `hits/${this.myId}`);
    onValue(hitRef, snapshot => {
      const data = snapshot.val();
      if (!data) return;

      // ── 핵심 수정 1: 리스폰 이전에 날아온 hit 무시 ──
      const hitTs = data.ts || 0;
      if (hitTs < this._respawnTime) {
        console.log('[🛡️] 리스폰 이전 hit 무시 (old ts)');
        remove(hitRef);
        return;
      }

      // ── 핵심 수정 2: 무적 시간 중 hit 무시 ──
      const now = Date.now();
      if (now - this._respawnTime < this._invincibleDuration) {
        console.log('[🛡️] 무적 시간 중 hit 무시');
        remove(hitRef);
        return;
      }

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
    set(ref(this.db, `players/${this.myId}`), { ...snapshot, ts: now }).catch(() => {});
  }

  sendHit(targetId, damage = 15) {
    set(ref(this.db, `hits/${targetId}`), {
      damage,
      from: this.myId,
      ts:   Date.now()
    }).catch(() => {});
  }

  // ── 핵심 수정 3: 리스폰 시 HP 리셋 + 타임스탬프 갱신 + hits 노드 삭제 ──
  sendRespawn(posArr) {
    const now = Date.now();

    // 내 HP 즉시 리셋
    this.myHealth     = 100;
    // 리스폰 시각 갱신 → 이 시각 이전 hit는 모두 무시됨
    this._respawnTime = now;

    // Firebase에 남아있는 내 hit 데이터 즉시 삭제
    remove(ref(this.db, `hits/${this.myId}`)).catch(() => {});

    // 플레이어 위치 갱신
    set(ref(this.db, `players/${this.myId}`), {
      pos:          posArr,
      health_reset: true,
      ts:           now
    }).catch(() => {});

    console.log('[🔄] 리스폰 완료 - HP 100, 무적 3초');
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
