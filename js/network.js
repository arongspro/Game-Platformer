// network.js - Firebase Realtime Database 멀티플레이어 (닉네임/픽셀/KD 포함)

import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, set, onValue, remove, onDisconnect, get, child } from 'firebase/database';

// 💡 환경 변수를 사용하여 민감한 정보 보호 (GitHub 노출 방지)
const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FB_API_KEY,
  authDomain:        import.meta.env.VITE_FB_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FB_DATABASE_URL,
  projectId:         import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FB_APP_ID,
  measurementId:     import.meta.env.VITE_FB_MEASUREMENT_ID
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

    // 킬뎃
    this.kills  = userInfo.kills  || 0;
    this.deaths = userInfo.deaths || 0;

    // 리스폰 무적
    this._respawnTime        = Date.now();
    this._invincibleDuration = 3000;

    this.onPlayersUpdate = null;
    this.onHealthUpdate  = null;
    this.onHit           = null;
    this.onKill          = null;   // 킬 발생 시 콜백

    this._lastSend    = 0;
    this._sendInterval = 50;

    this._setupListeners();
  }

  _setupListeners() {
    // 전체 플레이어 구독
    onValue(ref(this.db, 'players'), snapshot => {
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
    });

    // 피격 이벤트
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
    // 타겟 HP 추적 (로컬에서)
    if (!this._targetHp) this._targetHp = {};
    if (this._targetHp[targetId] === undefined) this._targetHp[targetId] = 100;
    this._targetHp[targetId] = Math.max(0, this._targetHp[targetId] - damage);

    set(ref(this.db, `hits/${targetId}`), {
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
    // DB에 킬 저장
    set(ref(this.db, `users/${this.myId}/kills`), this.kills).catch(()=>{});
    if (this.onKill) this.onKill(targetId, this.kills, this.deaths);
  }

  sendRespawn(posArr) {
    const now = Date.now();
    this.myHealth     = 100;
    this._respawnTime = now;
    this.deaths++;
    set(ref(this.db, `users/${this.myId}/deaths`), this.deaths).catch(()=>{});
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
