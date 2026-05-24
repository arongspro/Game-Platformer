// network.js — Firebase Realtime DB 제거, Socket.IO 사용
// 기존 API (onPlayersUpdate, sendHit, sendChat, 결투 등) 100% 유지

import { API_BASE } from './auth.js';

// Socket.IO 클라이언트 CDN (서버에서 자동 제공하거나 CDN 사용)
// 서버가 같은 오리진이면 /socket.io/socket.io.js 로 자동 제공됨
const SOCKET_URL = 'https://game-proxy.juhyung1234567910.workers.dev';

const SEND_INTERVAL  = 1;
const STALE_TIMEOUT  = 10_000;

export class Network {
  constructor(userInfo) {
    this.myUid    = userInfo.uid;
    this.myId     = userInfo.uid;
    this.nickname = userInfo.nickname;
    this.pixels   = userInfo.pixels;

    this.otherPlayers = {};
    this.myHealth     = 100;
    this.currentMapId = 'spire';

    // 결투 상태
    this.duelState     = null;
    this.duelOpponent  = null;
    this.duelRoomId    = null;
    this.duelStartTs   = null;
    this.onDuelRequest  = null;
    this.onDuelAccepted = null;
    this.onDuelDeclined = null;
    this.onDuelStart    = null;
    this.onDuelEnd      = null;
    this.onOnlinePlayers= null;

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
    this._processedHits      = new Set();
    this._processedExplosions = new Set();

    this.onPlayersUpdate = null;
    this.onHealthUpdate  = null;
    this.onHit           = null;
    this.onKill          = null;
    this.onRoundOver     = null; // 라운드 오버 (킬한 측이 broadcast → 양쪽 수신)
    this.onRoomUpdate    = null;
    this.onChat          = null;
    this.onExplosion     = null;

    this._connect();
  }

  // ── Socket 연결 ──────────────────────────────────────────
  _connect() {
    // socket.io 스크립트가 로드된 후 연결
    const doConnect = () => {
      this._socket = window.io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
      });

      this._socket.on('connect', () => {
        console.log('[Network] 소켓 연결됨:', this._socket.id);
        this._socket.emit('join', {
          uid:      this.myUid,
          nickname: this.nickname,
          roomId:   this.roomId,
          pixels:   this.pixels,
          kills:    this.totalKills,
          deaths:   this.totalDeaths,
          rating:   this.rating,
        });
      });

      this._socket.on('disconnect', () => {
        console.warn('[Network] 소켓 끊김');
      });

      this._socket.on('reconnect', () => {
        // 재연결 시 자동으로 join 재전송
        this._socket.emit('join', {
          uid: this.myUid, nickname: this.nickname,
          roomId: this.roomId, pixels: this.pixels,
          kills: this.totalKills, deaths: this.totalDeaths, rating: this.rating,
        });
      });

      // ── 플레이어 상태 ─────────────────────────────────
      this._socket.on('state_update', data => {
        const now    = Date.now();
        const others = {};
        for (const [uid, info] of Object.entries(data || {})) {
          if (uid === this.myUid) continue;
          if (info.ts && now - info.ts > STALE_TIMEOUT) continue;
          others[uid] = { ...info };
          if (info.health_reset) this._targetHp[uid] = 100;

          // 라운드 오버 신호 수신 (상대가 킬하고 브로드캐스트)
          if (info.round_over && info.round_over_ts && !this._processedRoundOver) {
            const key = `round_${info.round_over_ts}`;
            if (!this._seenRoundOver) this._seenRoundOver = new Set();
            if (!this._seenRoundOver.has(key)) {
              this._seenRoundOver.add(key);
              this.onRoundOver?.();
            }
          }

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
      });

      // ── 룸 메타 ───────────────────────────────────────
      this._socket.on('room_meta', m => {
        if (!m) return;
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
      });

      // ── 히트 수신 ─────────────────────────────────────
      this._socket.on('hits', hitList => {
        for (const h of hitList || []) {
          if (this._processedHits.has(h.id)) continue;
          this._processedHits.add(h.id);
          if ((h.ts || 0) < this._respawnTime || this.isInvincible()) continue;
          this.myHealth = Math.max(0, this.myHealth - (h.damage || 15));
          this.onHealthUpdate?.(this.myHealth);
          this.onHit?.(h.damage || 15);
        }
      });

      // ── 채팅 ──────────────────────────────────────────
      this._socket.on('chat', msg => {
        this.onChat?.(msg);
      });

      // ── 프레전스 ──────────────────────────────────────
      this._socket.on('presence_update', players => {
        this.onOnlinePlayers?.(players.map(p => ({ ...p, isSelf: p.uid === this.myUid })));
      });

      // ── 결투 ──────────────────────────────────────────
      this._socket.on('duel_request', d => {
        if (!d || Date.now() - d.ts > 30000) return;
        if (this.duelState && this.duelState !== 'pending_recv') return;
        this.duelState    = 'pending_recv';
        this.duelOpponent = { uid: d.fromUid, nickname: d.fromNick };
        this.onDuelRequest?.(d.fromUid, d.fromNick);
      });

      // 요청 보낸 사람 — 상대방이 accept 했을 때
      this._socket.on('duel_response', d => {
        console.log('[DUEL] duel_response received', d, 'state:', this.duelState);
        if (!d) return;
        if (d.status === 'accepted' && this.duelState === 'pending_sent') {
          this.duelState = 'picking';
          this._startWatchingRoom(d.roomId);
          this.onDuelAccepted?.();
        } else if (d.status === 'declined') {
          this.duelState    = null;
          this.duelOpponent = null;
          this.onDuelDeclined?.();
        }
      });

      // 수락한 사람(accepter) — 서버가 self 이벤트로 roomId 전달
      this._socket.on('duel_response_self', d => {
        console.log('[DUEL] duel_response_self received', d, 'state:', this.duelState);
        if (!d || d.status !== 'accepted') return;
        this.duelState = 'picking';
        this._startWatchingRoom(d.roomId);
        this.onDuelAccepted?.();
      });

      // heartbeat 30초마다
      this._heartbeatInterval = setInterval(() => {
        this._socket?.emit('heartbeat');
      }, 30000);
    };

    // socket.io 클라이언트 스크립트 동적 로드
    if (window.io) {
      doConnect();
    } else {
      const script  = document.createElement('script');
      script.src    = `${SOCKET_URL}/socket.io/socket.io.js`;
      script.onload = doConnect;
      script.onerror = () => {
        // CDN fallback
        const s2   = document.createElement('script');
        s2.src     = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
        s2.onload  = doConnect;
        document.head.appendChild(s2);
      };
      document.head.appendChild(script);
    }
  }

  // ── 위치/상태 전송 ────────────────────────────────────────
  sendUpdate(snapshot) {
    if (!this._socket?.connected) return;
    const now = Date.now();
    if (now - this._lastSend < SEND_INTERVAL) return;
    this._lastSend = now;

    this._socket.emit('state_update', {
      uid:         this.myUid,
      nickname:    this.nickname,
      pixels:      this.pixels,
      pos:         snapshot.pos,
      yaw:         snapshot.yaw,
      pitch:       snapshot.pitch,
      move_time:   snapshot.move_time,
      bob_amp:     snapshot.bob_amp,
      is_sliding:  snapshot.is_sliding,
      recoil:      snapshot.recoil,
      is_aiming:   snapshot.is_aiming,
      weapon_slot:     snapshot.weapon_slot    ?? 1,
      loadout:         snapshot.loadout        || [],
      is_reloading:    snapshot.is_reloading   ?? false,
      reload_progress: snapshot.reload_progress ?? 0,
      grenades:    snapshot.grenades || [],
      rockets:     snapshot.rockets  || [],
      mapId:       snapshot.mapId   || 'spire',
      kills:       this.kills,
      deaths:      this.deaths,
      totalKills:  this.totalKills,
      totalDeaths: this.totalDeaths,
      rating:      this.rating,
      ts:          now,
    });
  }

  // ── 히트 전송 ─────────────────────────────────────────────
  sendHit(targetUid, damage = 15, weaponType = 'rifle') {
    if (!this._socket?.connected) return;
    const VALID_WEAPONS = new Set(['rifle','sniper','pistol']);
    this._targetHp[targetUid] ??= 100;
    this._targetHp[targetUid]  = Math.max(0, this._targetHp[targetUid] - damage);
    this._socket.emit('send_hit', {
      targetUid,
      damage,
      weapon: VALID_WEAPONS.has(weaponType) ? weaponType : 'rifle',
      from:   this.myUid,
    });
    if (this._targetHp[targetUid] <= 0) {
      this._targetHp[targetUid] = 100;
      this.confirmKill(targetUid);
    }
  }

  // ── 킬 확정 ───────────────────────────────────────────────
  async confirmKill(targetUid) {
    this.kills++;
    this.totalKills++;
    this.rating += 25;
    this._syncStats();
    if (this.kills >= this.matchLimit) {
      this._socket?.emit('room_meta_update', {
        status: 'ended', winner: this.myUid, endedAt: Date.now(),
      });
    }
    this.onKill?.(targetUid, this.kills, this.deaths);
  }

  // ── 리스폰 ────────────────────────────────────────────────
  sendRespawn(posArr) {
    const now = Date.now();
    this.myHealth     = 100;
    this._respawnTime = now;
    this._processedHits = new Set();
    this.deaths++;
    this.totalDeaths++;
    this.rating = Math.max(0, this.rating - 10);
    this._syncStats();

    this._socket?.emit('state_update', {
      uid:         this.myUid,
      nickname:    this.nickname,
      pixels:      this.pixels,
      pos:         { x: posArr[0], y: posArr[1], z: posArr[2] },
      kills:       this.kills,
      deaths:      this.deaths,
      totalKills:  this.totalKills,
      totalDeaths: this.totalDeaths,
      rating:      this.rating,
      health_reset: true,
      mapId:       this.currentMapId || 'spire',
      ts:          now,
    });
  }

  // ── 라운드 오버 브로드캐스트 ──────────────────────────────
  sendRoundOver() {
    if (!this._socket?.connected) return;
    const ts = Date.now();
    this._socket.emit('state_update', {
      uid: this.myUid,
      round_over: true,
      round_over_ts: ts,
      ts,
    });
  }

  // ── 폭발 전송 ─────────────────────────────────────────────
  sendExplosion(posArr, type = 'grenade') {
    if (!this._socket?.connected) return;
    this._socket.emit('state_update', {
      uid: this.myUid,
      lastExplosion: { x: posArr[0], y: posArr[1], z: posArr[2], type, ts: Date.now() },
    });
  }

  // ── 채팅 전송 ─────────────────────────────────────────────
  sendChat(text) {
    if (!text || !this._socket?.connected) return;
    this._socket.emit('chat', { text });
  }

  listenChat(cb) { this.onChat = cb; }

  // ── 통계 서버에 저장 ──────────────────────────────────────
  _syncStats() {
    this._socket?.emit('update_stats', {
      nickname: this.nickname,
      kills:    this.totalKills,
      deaths:   this.totalDeaths,
      rating:   this.rating,
    });
  }

  // ── 룸 관련 ───────────────────────────────────────────────
  async createRoom(limit = 10) {
    const id = Math.random().toString(36).slice(2, 6).toUpperCase();
    await this.joinRoom(id, { name: id, limit, host: this.myUid, status: 'waiting', createdAt: Date.now() });
    return id;
  }

  async quickMatch(limit = 10) {
    return new Promise(resolve => {
      this._socket.emit('quick_match', { limit }, ({ roomId }) => {
        this.joinRoom(roomId).then(() => resolve(roomId));
      });
    });
  }

  async updateRoomLimit(limit = 10) {
    this.matchLimit = Number(limit) === 20 ? 20 : 10;
    localStorage.setItem('vp_match_limit', String(this.matchLimit));
    this._socket?.emit('room_meta_update', {
      limit: this.matchLimit,
      status: this.roomStatus === 'ended' ? 'waiting' : this.roomStatus,
      winner: null,
    });
  }

  async joinRoom(roomId, meta = null) {
    const nextRoom = String(roomId || '').trim().toUpperCase();
    if (!nextRoom) throw new Error('Room code is empty.');
    this.roomId = nextRoom;
    if (meta) {
      this.roomName   = meta.name || nextRoom;
      this.matchLimit = Number(meta.limit || this.matchLimit || 10);
    }
    this._respawnTime = Date.now();
    this._targetHp    = {};
    this.otherPlayers = {};
    this.kills  = 0;
    this.deaths = 0;
    this._processedExplosions = new Set();
    localStorage.setItem('vp_room_id', this.roomId);
    this._socket?.emit('change_room', { newRoomId: nextRoom, meta });
  }

  // ── 프레전스 ──────────────────────────────────────────────
  registerPresence() {
    // join 시 자동 등록되므로 별도 작업 불필요
    this.listenDuelRequests();
  }

  // ── 결투 ──────────────────────────────────────────────────
  listenDuelRequests() {
    // 소켓 이벤트로 자동 수신 (_connect에서 등록됨)
  }

  sendDuelRequest(targetUid, targetNick) {
    this.duelState    = 'pending_sent';
    this.duelOpponent = { uid: targetUid, nickname: targetNick };
    this._socket?.emit('duel_request', { targetUid, fromNick: this.nickname });
  }

  acceptDuel() {
    console.log('[DUEL] acceptDuel called, opponent:', this.duelOpponent, 'state:', this.duelState);
    if (!this.duelOpponent) return;
    const toUid = this.duelOpponent.uid;
    this._socket?.emit('duel_accept', { toUid });
  }

  declineDuel() {
    if (!this.duelOpponent) return;
    this._socket?.emit('duel_decline', { toUid: this.duelOpponent.uid });
    this.duelState    = null;
    this.duelOpponent = null;
  }

  // 단일 리스너 — picking 상태 진입 시 한 번만 호출
  _startWatchingRoom(roomId) {
    this.duelRoomId = roomId;
    const eventName = `duel_room_${roomId}`;
    this._socket?.off(eventName);
    this._socket?.emit('duel_score_listen', { roomId });
    this._duelScoreCb = null;
    this._socket?.on(eventName, d => {
      if (!d) return;
      if (this._duelScoreCb) this._duelScoreCb(d.score || {}, d);
      if (d.status === 'active' && this.duelState === 'picking') {
        this.duelState   = 'active';
        this.duelStartTs = d.startTs;
        this.onDuelStart?.(roomId);
      }
      if (d.status === 'ended' && this.duelState !== 'ended') {
        this.duelState = 'ended';
        this.onDuelEnd?.(d.winnerNick);
      }
    });
  }

  markDuelReady(loadout) {
    if (!this.duelRoomId) return;
    this._socket?.emit('duel_ready', { roomId: this.duelRoomId, loadout });
  }

  sendDuelKill(roomId, killerUid, killerNick) {
    this._socket?.emit('duel_kill', { roomId, killerNick });
  }

  endDuel(roomId, winnerNick) {
    this._socket?.emit('duel_end', { roomId, winnerNick });
  }

  listenDuelScore(roomId, cb) {
    this._duelScoreCb = cb;
    return () => { this._duelScoreCb = null; };
  }

  // ── 유틸 ──────────────────────────────────────────────────
  disconnect() {
    clearInterval(this._heartbeatInterval);
    this._socket?.disconnect();
  }

  isInvincible()   { return Date.now() - this._respawnTime < this._invincibleDuration; }
  getPlayerCount() { return Object.keys(this.otherPlayers).length + 1; }
}
