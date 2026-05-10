// main.js - 게임 루프, HUD, 세션 체크, 킬뎃, 이름표

import * as THREE from 'three';
import { Renderer }         from './renderer.js';
import { CameraController } from './camera.js';
import { Player }           from './player.js';
import { Network }          from './network.js';

// ── 세션 체크 (로그인 안 했으면 login.html로) ──
const rawUser = sessionStorage.getItem('vp_user');
if (!rawUser) { window.location.href = 'login.html'; }
const userInfo = JSON.parse(rawUser);

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
const scoreboardEl      = document.getElementById('scoreboard');
const myNickEl          = document.getElementById('my-nick');
const grenadeChargeEl   = document.getElementById('grenade-charge');
const grenadeChargeFill = document.getElementById('grenade-charge-fill');
const slot1El           = document.getElementById('slot-1');
const slot4El           = document.getElementById('slot-4');
const grenadeCountUI    = document.getElementById('grenade-count-ui');

// 닉네임 표시
myNickEl.textContent = userInfo.nickname;

// ── 초기화 ──
const renderer = new Renderer(canvas);
const camCtrl  = new CameraController(renderer.camera);
const player   = new Player(renderer.getBoxes(), renderer);
const network  = new Network(userInfo);

// 로컬 플레이어 픽셀 캐릭터 적용
setTimeout(() => {
  if (userInfo.pixels) player.applyPixels(userInfo.pixels);
}, 500);

const remoteMeshes = {};
const clock = new THREE.Clock();

// ── 포인터 락 ──
function tryLock() {
  const fn = canvas.requestPointerLock || canvas.mozRequestPointerLock || canvas.webkitRequestPointerLock;
  if (fn) fn.call(canvas);
}

lockBtn.addEventListener('click', e => { e.preventDefault(); tryLock(); });
lockOverlay.addEventListener('click', e => { e.preventDefault(); tryLock(); });

function isLocked() {
  return document.pointerLockElement === canvas ||
         document.mozPointerLockElement === canvas ||
         document.webkitPointerLockElement === canvas;
}

function onPointerLockChange() {
  lockOverlay.style.display = isLocked() ? 'none' : 'flex';
}
document.addEventListener('pointerlockchange',       onPointerLockChange);
document.addEventListener('mozpointerlockchange',    onPointerLockChange);
document.addEventListener('webkitpointerlockchange', onPointerLockChange);
document.addEventListener('pointerlockerror', () => console.warn('Pointer lock failed'));

// ── 마우스/키 ──
document.addEventListener('mousemove', e => {
  if (!isLocked()) return;
  camCtrl.onMouseMove(
    e.movementX || e.mozMovementX || 0,
    e.movementY || e.mozMovementY || 0,
    player.isAiming
  );
});
canvas.addEventListener('wheel', e => camCtrl.onWheel(e.deltaY > 0 ? 1 : -1), { passive:true });
canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  if (e.code === 'KeyR')   player.startReload();
  if (e.code === 'Escape') document.exitPointerLock?.();
  if (e.code === 'Tab') {
    e.preventDefault();
    showScoreboard(true);
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Tab') showScoreboard(false);
});

// ── 스코어보드 (TAB) ──
function showScoreboard(visible) {
  if (visible) {
    updateScoreboard();
    scoreboardEl.style.display = 'flex';
  } else {
    scoreboardEl.style.display = 'none';
  }
}

function updateScoreboard() {
  const rows = scoreboardEl.querySelector('.sb-rows');
  rows.innerHTML = '';

  // 내 정보
  const allPlayers = [
    { nick: network.nickname, kills: network.kills, deaths: network.deaths, isMe: true },
    ...Object.values(network.otherPlayers).map(p => ({
      nick:   p.nickname || '???',
      kills:  p.kills  || 0,
      deaths: p.deaths || 0,
      isMe:   false,
    }))
  ];

  // 킬 순 정렬
  allPlayers.sort((a,b) => b.kills - a.kills);

  allPlayers.forEach((p, i) => {
    const kd = p.deaths === 0 ? p.kills.toFixed(1) : (p.kills/p.deaths).toFixed(2);
    const row = document.createElement('div');
    row.className = 'sb-row' + (p.isMe ? ' sb-me' : '');
    row.innerHTML = `
      <span class="sb-rank">#${i+1}</span>
      <span class="sb-nick">${p.isMe ? '▶ ' : ''}${p.nick}</span>
      <span class="sb-kills">${p.kills}</span>
      <span class="sb-deaths">${p.deaths}</span>
      <span class="sb-kd">${kd}</span>
    `;
    rows.appendChild(row);
  });
}

// ── HUD ──
function updateHud() {
  const hp  = player.health;
  const pct = hp / player.maxHealth;
  healthFill.style.width = (pct * 100) + '%';
  healthNum.textContent  = hp;

  healthFill.className = '';
  if      (pct <= 0.3) { healthFill.classList.add('crit'); healthNum.style.color = '#ff3c3c'; }
  else if (pct <= 0.6) { healthFill.classList.add('warn'); healthNum.style.color = '#ffcc00'; }
  else                 { healthNum.style.color = ''; }

  if (player.weaponSlot === 1) {
    ammoCurrentEl.textContent = player.ammo;
    ammoMaxEl.textContent     = '/ ' + player.maxAmmo;
    ammoMode.textContent      = '[' + player.fireMode + ']';
  } else if (player.weaponSlot === 4) {
    ammoCurrentEl.textContent = '💣 ' + player.grenadeCount;
    ammoMaxEl.textContent     = '/ 3';
    const charge = Math.round((player.grenadeCharge / player.grenadeMaxCharge) * 100);
    ammoMode.textContent      = player.isChargingGrenade ? `[CHARGE ${charge}%]` : '[GRENADE]';
  }
  reloadBar.classList.toggle('visible', player.isReloading);

  const invincible = network.isInvincible();
  if (invincible) {
    const remainMs = 3000 - (Date.now() - network._respawnTime);
    dashCdEl.classList.add('visible');
    dashCdEl.textContent  = `🛡️ INVINCIBLE ${(remainMs/1000).toFixed(1)}s`;
    dashCdEl.style.color  = '#00ffe0';
  } else {
    dashCdEl.style.color  = '';
    dashCdEl.classList.toggle('visible', player.dashCooldown > 0);
    if (player.dashCooldown > 0)
      dashCdEl.textContent = `DASH CD: ${Math.ceil(player.dashCooldown/60)}s`;
  }
}

// ── 히트마커 ──
let hitmarkerTimer = 0;
function showHitmarker(isHeadshot = false) {
  hitmarker.classList.add('active');
  hitmarker.style.setProperty('--hm-color', isHeadshot ? '#ff3c3c' : '#ffffff');
  hitmarkerTimer = isHeadshot ? 350 : 200;
}

// ── 킬피드 ──
function addKillfeed(text, isKill = false) {
  const el = document.createElement('div');
  el.className   = 'killfeed-entry' + (isKill ? ' killfeed-kill' : '');
  el.textContent = text;
  killfeed.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── 부위별 히트박스 레이캐스트 ──
const HITBOXES = [
  { name:'HEAD', offsetY:1.95, halfH:0.27, radius:0.28, damage:20 },
  { name:'BODY', offsetY:1.25, halfH:0.35, radius:0.38, damage:10 },
  { name:'LEGS', offsetY:0.45, halfH:0.45, radius:0.28, damage: 5 },
];

function rayVsCapsule(origin, front, center, halfH, radius) {
  const oc = origin.clone().sub(center);
  const dx = front.x, dz = front.z;
  const ox = oc.x,    oz = oc.z;
  const a  = dx*dx + dz*dz;
  if (a < 1e-10) return Infinity;
  const b    = 2*(ox*dx + oz*dz);
  const c    = ox*ox + oz*oz - radius*radius;
  const disc = b*b - 4*a*c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2*a);
  if (t < 0) return Infinity;
  const hitY = origin.y + front.y * t;
  if (hitY < center.y - halfH - radius || hitY > center.y + halfH + radius) return Infinity;
  return t;
}

function checkHit() {
  const origin = camCtrl.getHeadPos();
  const front  = camCtrl.getFront();
  let bestDist=200, hitTarget=null, hitDamage=0, hitPart='';

  for (const [pid, info] of Object.entries(network.otherPlayers)) {
    if (!info?.pos) continue;
    const base = new THREE.Vector3(info.pos[0], info.pos[1], info.pos[2]);
    for (const hb of HITBOXES) {
      const center = base.clone(); center.y += hb.offsetY;
      const t = rayVsCapsule(origin, front, center, hb.halfH, hb.radius);
      if (t < bestDist) {
        bestDist = t; hitTarget = pid;
        hitDamage = hb.damage; hitPart = hb.name;
      }
    }
  }

  if (hitTarget) {
    network.sendHit(hitTarget, hitDamage);
    showHitmarker(hitPart === 'HEAD');
    const icon = hitPart==='HEAD' ? '🎯' : hitPart==='BODY' ? '💥' : '🦵';
    const targetNick = network.otherPlayers[hitTarget]?.nickname || hitTarget.slice(-4);
    addKillfeed(`${icon} ${hitPart} +${hitDamage} → ${targetNick}`);

    // 타겟 HP 0 예상 → 킬 확인 (서버에서 확인 불가하므로 클라이언트 추정)
    // 실제로는 network.onHealthUpdate에서 처리
  }
}

// ── 콜백 연결 ──
player.onShoot     = () => {};
player.onHudUpdate = updateHud;
player.onDie = () => {
  deathScreen.classList.add('active');
  setTimeout(() => deathScreen.classList.remove('active'), 1500);
  network.sendRespawn(player.pos.toArray());
  player.health = 100;
  updateHud();
};

// ── 수류탄 폭발 콜백 (직접 연결, setTimeout 없음) ──
player.grenadeSystem.onExplode = (pos, radius, maxDamage) => {
  // 내 위치 기준 화면 흔들림
  const myDist = player.pos.distanceTo(pos);
  if (myDist < radius * 1.5) {
    dmgFlash.classList.add('active');
    setTimeout(() => dmgFlash.classList.remove('active'), myDist < 3 ? 400 : 150);
  }

  // 다른 플레이어 피해
  for (const [pid, info] of Object.entries(network.otherPlayers)) {
    if (!info?.pos) continue;
    const tPos = new THREE.Vector3(info.pos[0], info.pos[1] + 0.9, info.pos[2]);
    const dist = tPos.distanceTo(pos);
    if (dist < radius) {
      const falloff = Math.max(0, 1 - (dist / radius));
      const dmg = Math.round(maxDamage * falloff * falloff);
      if (dmg > 0) {
        network.sendHit(pid, dmg);
        showHitmarker(false);
        const targetNick = info.nickname || pid.slice(-4);
        addKillfeed(`💣 GRENADE ${dmg} → ${targetNick}`);
      }
    }
  }
  addKillfeed('💥 EXPLOSION!');
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
  if (network.isInvincible()) return;
  player.health = hp;
  updateHud();
  dmgFlash.classList.add('active');
  setTimeout(() => dmgFlash.classList.remove('active'), 150);
};

network.onKill = (targetId, kills, deaths) => {
  const targetNick = network.otherPlayers[targetId]?.nickname || targetId.slice(-4);
  addKillfeed(`☠️ ${network.nickname} → ${targetNick}`, true);
};

// ── 메인 루프 ──
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (isLocked()) {
    player.update(camCtrl, checkHit);
    camCtrl.update(player.pos, player.isSliding, player.bobAmp,
                   player.moveTime, player.isJumping, player.currentRoll);

    adsVignette.style.opacity = player.adsProgress;

    if (hitmarkerTimer > 0) {
      hitmarkerTimer -= dt * 1000;
      if (hitmarkerTimer <= 0) hitmarker.classList.remove('active');
    }

    if (player.isReloading) {
      reloadFill.style.width = ((1 - player.reloadTimer/player.reloadDuration)*100) + '%';
    }

    renderer.updateParticles(dt);
    network.sendUpdate(player.getSnapshot(camCtrl));

    // ── 수류탄 충전바 / 슬롯 UI ──
    if (player.weaponSlot === 4 && player.isChargingGrenade) {
      grenadeChargeEl.classList.add('visible');
      const pct = (player.grenadeCharge / player.grenadeMaxCharge) * 100;
      grenadeChargeFill.style.width = pct + '%';
    } else {
      grenadeChargeEl.classList.remove('visible');
    }
    // 슬롯 하이라이트
    if (slot1El && slot4El) {
      slot1El.classList.toggle('active', player.weaponSlot === 1);
      slot4El.classList.toggle('active', player.weaponSlot === 4);
      if (grenadeCountUI) grenadeCountUI.textContent = `×${player.grenadeCount}`;
    }
  }

  renderer.render(renderer.camera);
}

updateHud();
playerCountEl.textContent = 'PLAYERS: 1';
loop();
