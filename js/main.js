// main.js - 게임 루프, HUD, 이벤트 연결

import * as THREE from 'three';
import { Renderer }         from './renderer.js';
import { CameraController } from './camera.js';
import { Player }           from './player.js';
import { Network }          from './network.js';

// ── DOM ──
const canvas        = document.getElementById('canvas');
const lockOverlay   = document.getElementById('lock-overlay');
const lockBtn       = document.getElementById('lock-btn');
const deathScreen   = document.getElementById('death-screen');
const dmgFlash      = document.getElementById('damage-flash');
const adsVignette   = document.getElementById('ads-vignette');
const hitmarker     = document.getElementById('hitmarker');
const reloadBar     = document.getElementById('reload-bar');
const reloadFill    = document.getElementById('reload-fill');
const healthFill    = document.getElementById('health-fill');
const healthNum     = document.getElementById('health-num');
const ammoCurrentEl = document.getElementById('ammo-current');
const ammoMaxEl     = document.getElementById('ammo-max');
const ammoMode      = document.getElementById('ammo-mode');
const dashCdEl      = document.getElementById('dash-cd');
const playerCountEl = document.getElementById('player-count');
const killfeed      = document.getElementById('killfeed');

// ── 초기화 ──
const renderer = new Renderer(canvas);
const camCtrl  = new CameraController(renderer.camera);
const player   = new Player(renderer.getBoxes(), renderer);
const network  = new Network();
const remoteMeshes = {};
const clock = new THREE.Clock();

// ────────────────────────────────────────────
// 포인터 락
// ────────────────────────────────────────────
function tryLock() {
  canvas.requestPointerLock =
    canvas.requestPointerLock       ||
    canvas.mozRequestPointerLock    ||
    canvas.webkitRequestPointerLock;
  if (canvas.requestPointerLock) canvas.requestPointerLock();
}

// 버튼 클릭 → 락
lockBtn.addEventListener('click', (e) => {
  e.preventDefault();
  tryLock();
});

// 오버레이 클릭 → 락 (버튼 놓쳐도 됨)
lockOverlay.addEventListener('click', (e) => {
  e.preventDefault();
  tryLock();
});

// 락 상태 변경 감지
function onPointerLockChange() {
  const locked = (
    document.pointerLockElement    === canvas ||
    document.mozPointerLockElement === canvas ||
    document.webkitPointerLockElement === canvas
  );
  lockOverlay.style.display = locked ? 'none' : 'flex';
}
document.addEventListener('pointerlockchange',       onPointerLockChange);
document.addEventListener('mozpointerlockchange',    onPointerLockChange);
document.addEventListener('webkitpointerlockchange', onPointerLockChange);

// 락 오류 처리
document.addEventListener('pointerlockerror', () => {
  console.warn('Pointer lock failed');
});

// ────────────────────────────────────────────
// 마우스/키 이벤트
// ────────────────────────────────────────────
document.addEventListener('mousemove', (e) => {
  const locked = (
    document.pointerLockElement    === canvas ||
    document.mozPointerLockElement === canvas ||
    document.webkitPointerLockElement === canvas
  );
  if (!locked) return;
  camCtrl.onMouseMove(e.movementX || e.mozMovementX || 0,
                      e.movementY || e.mozMovementY || 0,
                      player.isAiming);
});

canvas.addEventListener('wheel', (e) => {
  camCtrl.onWheel(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR')   player.startReload();
  if (e.code === 'Escape') document.exitPointerLock?.();
});

// ────────────────────────────────────────────
// HUD
// ────────────────────────────────────────────
function updateHud() {
  const hp  = player.health;
  const pct = hp / player.maxHealth;
  healthFill.style.width = (pct * 100) + '%';
  healthNum.textContent  = hp;

  healthFill.className = '';
  if (pct <= 0.3)      { healthFill.classList.add('crit'); healthNum.style.color = '#ff3c3c'; }
  else if (pct <= 0.6) { healthFill.classList.add('warn'); healthNum.style.color = '#ffcc00'; }
  else                 { healthNum.style.color = ''; }

  ammoCurrentEl.textContent = player.ammo;
  ammoMaxEl.textContent     = '/ ' + player.maxAmmo;
  ammoMode.textContent      = '[' + player.fireMode + ']';

  reloadBar.classList.toggle('visible', player.isReloading);

  // 무적 시간 or 대시 쿨다운 표시
  const invincible = network.isInvincible();
  if (invincible) {
    const remainMs = 3000 - (Date.now() - network._respawnTime);
    dashCdEl.classList.add('visible');
    dashCdEl.textContent = `🛡️ INVINCIBLE ${(remainMs/1000).toFixed(1)}s`;
    dashCdEl.style.color = '#00ffe0';
  } else {
    dashCdEl.style.color = '';
    dashCdEl.classList.toggle('visible', player.dashCooldown > 0);
    if (player.dashCooldown > 0)
      dashCdEl.textContent = `DASH CD: ${Math.ceil(player.dashCooldown/60)}s`;
  }
}

// ────────────────────────────────────────────
// 히트마커 / 킬피드
// ────────────────────────────────────────────
let hitmarkerTimer = 0;
function showHitmarker() {
  hitmarker.classList.add('active');
  hitmarkerTimer = 200;
}

function addKillfeed(text) {
  const el = document.createElement('div');
  el.className   = 'killfeed-entry';
  el.textContent = text;
  killfeed.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ────────────────────────────────────────────
// 레이캐스트 히트체크
// ────────────────────────────────────────────
function checkHit() {
  const origin = camCtrl.getHeadPos();
  const front  = camCtrl.getFront();
  let minDist = 100, hitTarget = null;

  for (const [pid, info] of Object.entries(network.otherPlayers)) {
    if (!info?.pos) continue;
    const tPos = new THREE.Vector3(info.pos[0], info.pos[1]+0.9, info.pos[2]);
    const v = tPos.clone().sub(origin);
    const t = v.dot(front);
    if (t < 0) continue;
    const nearest = origin.clone().addScaledVector(front, t);
    if (tPos.distanceTo(nearest) < 0.6 && t < minDist) {
      minDist = t; hitTarget = pid;
    }
  }

  if (hitTarget) {
    network.sendHit(hitTarget, 15);
    showHitmarker();
    addKillfeed(`💥 HIT → ${hitTarget.slice(-4)}`);
  }
}

// ────────────────────────────────────────────
// 콜백 연결
// ────────────────────────────────────────────
player.onShoot     = () => {};
player.onHudUpdate = updateHud;
player.onDie = () => {
  deathScreen.classList.add('active');
  setTimeout(() => deathScreen.classList.remove('active'), 1500);
  // network.sendRespawn 안에서 myHealth=100 + respawnTime 갱신 + hits 삭제
  network.sendRespawn(player.pos.toArray());
  // player.health도 즉시 100으로 동기화
  player.health = 100;
  updateHud();
};

network.onPlayersUpdate = (others) => {
  for (const pid of Object.keys(remoteMeshes)) {
    if (!others[pid]) renderer.removeRemotePlayer(pid, remoteMeshes);
  }
  for (const [pid, info] of Object.entries(others)) {
    renderer.createOrUpdateRemotePlayer(pid, info, remoteMeshes);
  }
  playerCountEl.textContent = `PLAYERS: ${network.getPlayerCount()}`;
};

network.onHealthUpdate = (hp) => {
  // 무적 시간 중이면 HP 변경 무시 (network.js에서 1차 차단, 여기서 2차)
  if (network.isInvincible()) return;
  player.health = hp;
  updateHud();
  dmgFlash.classList.add('active');
  setTimeout(() => dmgFlash.classList.remove('active'), 150);
};

// ────────────────────────────────────────────
// 메인 루프
// ────────────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  const locked = (
    document.pointerLockElement    === canvas ||
    document.mozPointerLockElement === canvas ||
    document.webkitPointerLockElement === canvas
  );

  // 락 상태일 때만 게임 로직 실행
  if (locked) {
    player.update(camCtrl, checkHit);
    camCtrl.update(
      player.pos,
      player.isSliding,
      player.bobAmp,
      player.moveTime,
      player.isJumping,
      player.currentRoll
    );

    // ADS 비네트
    adsVignette.style.opacity = player.adsProgress;

    // 히트마커 타이머
    if (hitmarkerTimer > 0) {
      hitmarkerTimer -= dt * 1000;
      if (hitmarkerTimer <= 0) hitmarker.classList.remove('active');
    }

    // 리로드 진행 바
    if (player.isReloading) {
      const prog = 1 - (player.reloadTimer / player.reloadDuration);
      reloadFill.style.width = (prog * 100) + '%';
    }

    // 파티클 업데이트
    renderer.updateParticles(dt);

    // 네트워크 전송
    network.sendUpdate(player.getSnapshot(camCtrl));
  }

  // 항상 렌더 (락 여부 무관)
  renderer.render(renderer.camera);
}

// ── 시작 ──
updateHud();
playerCountEl.textContent = 'PLAYERS: 1';
loop();
