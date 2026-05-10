// main.js - 게임 루프, HUD, 세션 체크, 킬뎃, 이름표

import * as THREE from 'three';
import { Renderer }         from './renderer.js';
import { CameraController } from './camera.js';
import { Player }           from './player.js';
import { Network }          from './network.js';

// ── 세션 체크 (로그인 안 했으면 login.html로) ──
const rawUser = sessionStorage.getItem('vp_user');
if (!rawUser) { window.location.href = 'login.html'; }
const userInfo = JSON.parse(rawUser);// main.js - 게임 루프, HUD, 세션 체크, 킬뎃, 이름표

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
const bandageBar    = document.getElementById('bandage-bar');
const bandageFill   = document.getElementById('bandage-fill');
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
const slot3El           = document.getElementById('slot-3');
const grenadeCountUI    = document.getElementById('grenade-count-ui');
const bandageCountUI    = document.getElementById('bandage-count-ui');

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
    ammoMaxEl.textContent     = '/ ' + player.maxAmmo + '  [' + player.totalAmmo + ']';
    ammoMode.textContent      = '[' + player.fireMode + ']';
  } else if (player.weaponSlot === 4) {
    ammoCurrentEl.textContent = '💣 ' + player.grenadeCount;
    ammoMaxEl.textContent     = '/ 3';
    const charge = Math.round((player.grenadeCharge / player.grenadeMaxCharge) * 100);
    ammoMode.textContent      = player.isChargingGrenade ? `[CHARGE ${charge}%]` : '[GRENADE]';
  }
  reloadBar.classList.toggle('visible', player.isReloading);
  bandageBar.classList.toggle('visible', player.isBandaging);

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

// 레이 vs AABB 박스 교차 거리 반환 (교차 없으면 Infinity)
function rayVsBox(origin, front, box) {
  const [bx, by, bz] = box.pos;
  const [sx, sy, sz] = box.size;
  const minX = bx - sx, maxX = bx + sx;
  const minY = by - sy, maxY = by + sy;
  const minZ = bz - sz, maxZ = bz + sz;

  const invDx = front.x !== 0 ? 1 / front.x : Infinity;
  const invDy = front.y !== 0 ? 1 / front.y : Infinity;
  const invDz = front.z !== 0 ? 1 / front.z : Infinity;

  const tMinX = (minX - origin.x) * invDx;
  const tMaxX = (maxX - origin.x) * invDx;
  const tMinY = (minY - origin.y) * invDy;
  const tMaxY = (maxY - origin.y) * invDy;
  const tMinZ = (minZ - origin.z) * invDz;
  const tMaxZ = (maxZ - origin.z) * invDz;

  const tEnter = Math.max(Math.min(tMinX, tMaxX), Math.min(tMinY, tMaxY), Math.min(tMinZ, tMaxZ));
  const tExit  = Math.min(Math.max(tMinX, tMaxX), Math.max(tMinY, tMaxY), Math.max(tMinZ, tMaxZ));

  if (tExit < 0 || tEnter > tExit) return Infinity;
  return tEnter > 0 ? tEnter : tExit;
}

// 레이가 맵 벽에 가로막히는지 검사 - 가장 가까운 벽 거리 반환
function wallBlockDist(origin, front) {
  const boxes = player.boxes;
  let minDist = Infinity;
  for (const b of boxes) {
    const d = rayVsBox(origin, front, b);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function checkHit() {
  const origin = camCtrl.getHeadPos();
  const front  = camCtrl.getFront();
  let bestDist=200, hitTarget=null, hitDamage=0, hitPart='';

  // 벽까지의 거리 — 이보다 멀리 있는 플레이어는 맞지 않음
  const wallDist = wallBlockDist(origin, front);

  for (const [pid, info] of Object.entries(network.otherPlayers)) {
    if (!info?.pos) continue;
    const base = new THREE.Vector3(info.pos[0], info.pos[1], info.pos[2]);
    for (const hb of HITBOXES) {
      const center = base.clone(); center.y += hb.offsetY;
      const t = rayVsCapsule(origin, front, center, hb.halfH, hb.radius);
      if (t < bestDist && t < wallDist) {   // 벽보다 가까울 때만 히트
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

// ── 보급상자 ──
const CRATE_INTERACT_DIST = 3.5;

// 플랫폼별 상자 위치 [x, y, z]
// 각 플랫폼 중앙, 구조물이 있으면 그 뒤쪽에 배치
// 1) 스폰(y=1):  코너 기둥 뒤  → z=+방향쪽 안쪽
// 2) 계단 플랫폼(y=6):  왼쪽 탑(x=-13,z=42) 뒤 → z=44
// 3) 중간 플랫폼(y=13.5): 큐브(0,15,99) 뒤 → z=102
// 4) 최종 플랫폼(y=24):  큰 큐브(0,25,152) 뒤 → z=156
const CRATE_DEFS = [
  { pos: new THREE.Vector3(  0,  2.2,   0) },   // 스폰: 수정 전 원래 위치
  { pos: new THREE.Vector3(  0,  6.6,  35) },   // 계단 플랫폼 중앙
  { pos: new THREE.Vector3(  0, 14.6, 102) },   // 중간 플랫폼: 큐브 뒤
  { pos: new THREE.Vector3(  0, 24.6, 156) },   // 최종 플랫폼: 큰 큐브 뒤
];

function makeELabel() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 80;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.roundRect(0, 0, 256, 80, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,0,0.85)';
  ctx.lineWidth = 2;
  ctx.roundRect(1, 1, 254, 78, 10); ctx.stroke();
  ctx.fillStyle = '#ffdd00';
  ctx.font = 'bold 28px "Share Tech Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('[ E ]  RESUPPLY', 128, 34);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '16px "Share Tech Mono", monospace';
  ctx.fillText('Ammo + Grenades', 128, 62);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  const mat    = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.7, 1);
  sprite.renderOrder = 999;
  sprite.visible = false;
  return sprite;
}

// 상자 생성 함수
function buildCrate(pos) {
  const group = new THREE.Group();
  group.position.copy(pos);

  // 몸통
  const mat  = new THREE.MeshLambertMaterial({ color: 0x997733 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  // 십자 표시 (윗면)
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const cV = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.55), crossMat);
  const cH = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.15), crossMat);
  cV.position.y = cH.position.y = 0.62;
  group.add(cV, cH);

  renderer.scene.add(group);

  // 라벨 스프라이트
  const label = makeELabel();
  label.position.copy(pos);
  label.position.y += 1.6;
  renderer.scene.add(label);

  return { group, mesh, mat, label, pos };
}

const crates = CRATE_DEFS.map(d => buildCrate(d.pos));

// E키 상호작용
window.addEventListener('keydown', e => {
  if (e.code !== 'KeyE') return;
  // 탄약·수류탄 모두 가득 차면 무시
  const isFull = player.ammo === player.maxAmmo &&
                 player.totalAmmo === player.maxTotalAmmo &&
                 player.grenadeCount === player.maxGrenades &&
                 player.bandageCount === player.maxBandage;
  if (isFull) return;

  for (const crate of crates) {
    if (player.pos.distanceTo(crate.pos) <= CRATE_INTERACT_DIST) {
      player.refillFromCrate();
      addKillfeed('📦 보급 완료! 탄약 + 수류탄 리필');
      crate.mat.color.set(0x00ff88);
      setTimeout(() => crate.mat.color.set(0x997733), 300);
      break;
    }
  }
});

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

player.onBandageUsed = () => {
  addKillfeed('🩹 붕대 사용 완료! +30 HP');
  updateHud();
};
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
    if (player.isBandaging) {
      bandageFill.style.width = ((1 - player.bandageTimer/player.bandageDuration)*100) + '%';
      bandageBar.classList.add('visible');
    } else {
      bandageBar.classList.remove('visible');
    }

    renderer.updateParticles(dt);
    network.sendUpdate(player.getSnapshot(camCtrl));

    // 보급상자: 가까이 있고 탄약이 부족할 때만 라벨 표시, 상자 회전
    const isFull = player.ammo === player.maxAmmo &&
                   player.totalAmmo === player.maxTotalAmmo &&
                   player.grenadeCount === player.maxGrenades &&
                   player.bandageCount === player.maxBandage;
    for (const crate of crates) {
      const near = player.pos.distanceTo(crate.pos) <= CRATE_INTERACT_DIST;
      crate.label.visible = near && !isFull;
      crate.group.rotation.y += 0.008;
    }

    // ── 수류탄 충전바 / 슬롯 UI ──
    if (player.weaponSlot === 4 && player.isChargingGrenade) {
      grenadeChargeEl.classList.add('visible');
      const pct = (player.grenadeCharge / player.grenadeMaxCharge) * 100;
      grenadeChargeFill.style.width = pct + '%';
    } else {
      grenadeChargeEl.classList.remove('visible');
    }
    // 슬롯 하이라이트
    if (slot1El && slot4El && slot3El) {
      slot1El.classList.toggle('active', player.weaponSlot === 1);
      slot4El.classList.toggle('active', player.weaponSlot === 4);
      slot3El.classList.toggle('active', player.weaponSlot === 3);
      if (grenadeCountUI) grenadeCountUI.textContent = `×${player.grenadeCount}`;
      if (bandageCountUI) bandageCountUI.textContent = `×${player.bandageCount}`;
    }
  }

  renderer.render(renderer.camera);
}

updateHud();
playerCountEl.textContent = 'PLAYERS: 1';
loop();

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
const bandageBar    = document.getElementById('bandage-bar');
const bandageFill   = document.getElementById('bandage-fill');
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
const slot3El           = document.getElementById('slot-3');
const grenadeCountUI    = document.getElementById('grenade-count-ui');
const bandageCountUI    = document.getElementById('bandage-count-ui');

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
    ammoMaxEl.textContent     = '/ ' + player.maxAmmo + '  [' + player.totalAmmo + ']';
    ammoMode.textContent      = '[' + player.fireMode + ']';
  } else if (player.weaponSlot === 4) {
    ammoCurrentEl.textContent = '💣 ' + player.grenadeCount;
    ammoMaxEl.textContent     = '/ 3';
    const charge = Math.round((player.grenadeCharge / player.grenadeMaxCharge) * 100);
    ammoMode.textContent      = player.isChargingGrenade ? `[CHARGE ${charge}%]` : '[GRENADE]';
  }
  reloadBar.classList.toggle('visible', player.isReloading);
  bandageBar.classList.toggle('visible', player.isBandaging);

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

// 레이 vs AABB 박스 교차 거리 반환 (교차 없으면 Infinity)
function rayVsBox(origin, front, box) {
  const [bx, by, bz] = box.pos;
  const [sx, sy, sz] = box.size;
  const minX = bx - sx, maxX = bx + sx;
  const minY = by - sy, maxY = by + sy;
  const minZ = bz - sz, maxZ = bz + sz;

  const invDx = front.x !== 0 ? 1 / front.x : Infinity;
  const invDy = front.y !== 0 ? 1 / front.y : Infinity;
  const invDz = front.z !== 0 ? 1 / front.z : Infinity;

  const tMinX = (minX - origin.x) * invDx;
  const tMaxX = (maxX - origin.x) * invDx;
  const tMinY = (minY - origin.y) * invDy;
  const tMaxY = (maxY - origin.y) * invDy;
  const tMinZ = (minZ - origin.z) * invDz;
  const tMaxZ = (maxZ - origin.z) * invDz;

  const tEnter = Math.max(Math.min(tMinX, tMaxX), Math.min(tMinY, tMaxY), Math.min(tMinZ, tMaxZ));
  const tExit  = Math.min(Math.max(tMinX, tMaxX), Math.max(tMinY, tMaxY), Math.max(tMinZ, tMaxZ));

  if (tExit < 0 || tEnter > tExit) return Infinity;
  return tEnter > 0 ? tEnter : tExit;
}

// 레이가 맵 벽에 가로막히는지 검사 - 가장 가까운 벽 거리 반환
function wallBlockDist(origin, front) {
  const boxes = player.boxes;
  let minDist = Infinity;
  for (const b of boxes) {
    const d = rayVsBox(origin, front, b);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function checkHit() {
  const origin = camCtrl.getHeadPos();
  const front  = camCtrl.getFront();
  let bestDist=200, hitTarget=null, hitDamage=0, hitPart='';

  // 벽까지의 거리 — 이보다 멀리 있는 플레이어는 맞지 않음
  const wallDist = wallBlockDist(origin, front);

  for (const [pid, info] of Object.entries(network.otherPlayers)) {
    if (!info?.pos) continue;
    const base = new THREE.Vector3(info.pos[0], info.pos[1], info.pos[2]);
    for (const hb of HITBOXES) {
      const center = base.clone(); center.y += hb.offsetY;
      const t = rayVsCapsule(origin, front, center, hb.halfH, hb.radius);
      if (t < bestDist && t < wallDist) {   // 벽보다 가까울 때만 히트
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

// ── 보급상자 ──
const CRATE_INTERACT_DIST = 3.5;

// 플랫폼별 상자 위치 [x, y, z]
// 각 플랫폼 중앙, 구조물이 있으면 그 뒤쪽에 배치
// 1) 스폰(y=1):  코너 기둥 뒤  → z=+방향쪽 안쪽
// 2) 계단 플랫폼(y=6):  왼쪽 탑(x=-13,z=42) 뒤 → z=44
// 3) 중간 플랫폼(y=13.5): 큐브(0,15,99) 뒤 → z=102
// 4) 최종 플랫폼(y=24):  큰 큐브(0,25,152) 뒤 → z=156
const CRATE_DEFS = [
  { pos: new THREE.Vector3(  0,  2.2,   0) },   // 스폰: 수정 전 원래 위치
  { pos: new THREE.Vector3(  0,  6.6,  35) },   // 계단 플랫폼 중앙
  { pos: new THREE.Vector3(  0, 14.6, 102) },   // 중간 플랫폼: 큐브 뒤
  { pos: new THREE.Vector3(  0, 24.6, 156) },   // 최종 플랫폼: 큰 큐브 뒤
];

function makeELabel() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 80;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.roundRect(0, 0, 256, 80, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,0,0.85)';
  ctx.lineWidth = 2;
  ctx.roundRect(1, 1, 254, 78, 10); ctx.stroke();
  ctx.fillStyle = '#ffdd00';
  ctx.font = 'bold 28px "Share Tech Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('[ E ]  RESUPPLY', 128, 34);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '16px "Share Tech Mono", monospace';
  ctx.fillText('Ammo + Grenades', 128, 62);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  const mat    = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.7, 1);
  sprite.renderOrder = 999;
  sprite.visible = false;
  return sprite;
}

// 상자 생성 함수
function buildCrate(pos) {
  const group = new THREE.Group();
  group.position.copy(pos);

  // 몸통
  const mat  = new THREE.MeshLambertMaterial({ color: 0x997733 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  // 십자 표시 (윗면)
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const cV = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.55), crossMat);
  const cH = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.15), crossMat);
  cV.position.y = cH.position.y = 0.62;
  group.add(cV, cH);

  renderer.scene.add(group);

  // 라벨 스프라이트
  const label = makeELabel();
  label.position.copy(pos);
  label.position.y += 1.6;
  renderer.scene.add(label);

  return { group, mesh, mat, label, pos };
}

const crates = CRATE_DEFS.map(d => buildCrate(d.pos));

// E키 상호작용
window.addEventListener('keydown', e => {
  if (e.code !== 'KeyE') return;
  // 탄약·수류탄 모두 가득 차면 무시
  const isFull = player.ammo === player.maxAmmo &&
                 player.totalAmmo === player.maxTotalAmmo &&
                 player.grenadeCount === player.maxGrenades &&
                 player.bandageCount === player.maxBandage;
  if (isFull) return;

  for (const crate of crates) {
    if (player.pos.distanceTo(crate.pos) <= CRATE_INTERACT_DIST) {
      player.refillFromCrate();
      addKillfeed('📦 보급 완료! 탄약 + 수류탄 리필');
      crate.mat.color.set(0x00ff88);
      setTimeout(() => crate.mat.color.set(0x997733), 300);
      break;
    }
  }
});

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

player.onBandageUsed = () => {
  addKillfeed('🩹 붕대 사용 완료! +30 HP');
  updateHud();
};
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
    if (player.isBandaging) {
      bandageFill.style.width = ((1 - player.bandageTimer/player.bandageDuration)*100) + '%';
      bandageBar.classList.add('visible');
    } else {
      bandageBar.classList.remove('visible');
    }

    renderer.updateParticles(dt);
    network.sendUpdate(player.getSnapshot(camCtrl));

    // 보급상자: 가까이 있고 탄약이 부족할 때만 라벨 표시, 상자 회전
    const isFull = player.ammo === player.maxAmmo &&
                   player.totalAmmo === player.maxTotalAmmo &&
                   player.grenadeCount === player.maxGrenades &&
                   player.bandageCount === player.maxBandage;
    for (const crate of crates) {
      const near = player.pos.distanceTo(crate.pos) <= CRATE_INTERACT_DIST;
      crate.label.visible = near && !isFull;
      crate.group.rotation.y += 0.008;
    }

    // ── 수류탄 충전바 / 슬롯 UI ──
    if (player.weaponSlot === 4 && player.isChargingGrenade) {
      grenadeChargeEl.classList.add('visible');
      const pct = (player.grenadeCharge / player.grenadeMaxCharge) * 100;
      grenadeChargeFill.style.width = pct + '%';
    } else {
      grenadeChargeEl.classList.remove('visible');
    }
    // 슬롯 하이라이트
    if (slot1El && slot4El && slot3El) {
      slot1El.classList.toggle('active', player.weaponSlot === 1);
      slot4El.classList.toggle('active', player.weaponSlot === 4);
      slot3El.classList.toggle('active', player.weaponSlot === 3);
      if (grenadeCountUI) grenadeCountUI.textContent = `×${player.grenadeCount}`;
      if (bandageCountUI) bandageCountUI.textContent = `×${player.bandageCount}`;
    }
  }

  renderer.render(renderer.camera);
}

updateHud();
playerCountEl.textContent = 'PLAYERS: 1';
loop();
