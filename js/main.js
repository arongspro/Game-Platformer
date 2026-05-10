// main.js - 게임 루프, HUD, 세션 체크, 킬뎃, 이름표

import * as THREE from 'three';
import { Renderer }         from './renderer.js';
import { CameraController } from './camera.js';
import { Player }           from './player.js';
import { Network }          from './network.js';
import { getRatingTier }    from './ranks.js';
import { WEAPON_CATALOG, getWeaponById, normalizeLoadout } from './weapons.js';

// ── 세션 체크 (로그인 안 했으면 login.html로) ──
const rawUser = sessionStorage.getItem('vp_user');
if (!rawUser) {
  window.location.href = 'login.html';
  await new Promise(() => {});
}
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
const slot2El           = document.getElementById('slot-2');
const slot5El           = document.getElementById('slot-5');
const grenadeCountUI    = document.getElementById('grenade-count-ui');
const bandageCountUI    = document.getElementById('bandage-count-ui');
const sniperCountUI     = document.getElementById('sniper-count-ui');
const pistolCountUI     = document.getElementById('pistol-count-ui');
const sniperScopeEl     = document.getElementById('sniper-scope');
const scopeCanvas       = document.getElementById('scope-canvas');
const matchGoalEl       = document.getElementById('match-goal');
const matchKillsEl      = document.getElementById('match-kills');
const matchStatusEl     = document.getElementById('match-status');
const tierNameEl        = document.getElementById('tier-name');
const tierRatingEl      = document.getElementById('tier-rating');
const tierBadgeEl       = document.getElementById('tier-badge');
const matchLimitSelect  = document.getElementById('match-limit-select');
const roomCodeEl        = document.getElementById('room-code');
const roomStatusEl      = document.getElementById('room-status');
const roomInputEl       = document.getElementById('room-input');
const roomCreateBtn     = document.getElementById('room-create-btn');
const roomQuickBtn      = document.getElementById('room-quick-btn');
const roomJoinBtn       = document.getElementById('room-join-btn');
const mapSelectEl       = document.getElementById('map-select');
const loadoutGridEl     = document.getElementById('loadout-grid');
const loadoutSlotsEl    = document.getElementById('loadout-slots');
const fpsDisplayEl      = document.getElementById('fps-display');
const pingDisplayEl     = document.getElementById('ping-display');
const chatMessagesEl    = document.getElementById('chat-messages');
const chatInputWrapEl   = document.getElementById('chat-input-wrap');
const chatInputEl       = document.getElementById('chat-input');

// FPS / Ping 측정
let _fpsFrames = 0, _fpsAccum = 0, _fpsValue = 0;
let _pingValue = 0;
function _measurePing() {
  const start = Date.now();
  // Firebase 핑: 작은 타임스탬프 읽기로 RTT 측정
  import('firebase/database').then(({ getDatabase, ref, get }) => {
    const db = getDatabase();
    get(ref(db, '.info/serverTimeOffset')).then(() => {
      _pingValue = Date.now() - start;
    }).catch(() => {});
  }).catch(() => {});
}
setInterval(_measurePing, 3000);
_measurePing();


const BASE_CENTER = new THREE.Vector3(0, 1, 5);
const BASE_RADIUS = 17;
const storedLimit = Number(localStorage.getItem('vp_match_limit') || 10);
let matchKillLimit = storedLimit === 20 ? 20 : 10;
let matchEnded = false;
if (matchLimitSelect) matchLimitSelect.value = String(matchKillLimit);

// 닉네임 표시
myNickEl.textContent = userInfo.nickname;

// ── 초기화 ──
const renderer = new Renderer(canvas);
const camCtrl  = new CameraController(renderer.camera);
const player   = new Player(renderer.getBoxes(), renderer);
const network  = new Network(userInfo);
player.canUseBaseAction = () => isAtBase();

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
document.getElementById('room-panel')?.addEventListener('click', e => e.stopPropagation());
document.getElementById('match-limit-wrap')?.addEventListener('click', e => e.stopPropagation());

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
    player.isAiming,
    player.scopeProgress
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
matchLimitSelect?.addEventListener('change', async () => {
  matchKillLimit = Number(matchLimitSelect.value) === 20 ? 20 : 10;
  localStorage.setItem('vp_match_limit', String(matchKillLimit));
  matchEnded = false;
  await network.updateRoomLimit(matchKillLimit);
  updateMatchHud();
});
roomCreateBtn?.addEventListener('click', async e => {
  e.preventDefault();
  await network.createRoom(matchKillLimit);
  addKillfeed(`ROOM CREATED · ${network.roomId}`);
  updateRoomHud();
});
roomQuickBtn?.addEventListener('click', async e => {
  e.preventDefault();
  await network.quickMatch(matchKillLimit);
  addKillfeed(`MATCHED · ${network.roomId}`);
  updateRoomHud();
});
roomJoinBtn?.addEventListener('click', async e => {
  e.preventDefault();
  const code = roomInputEl?.value?.trim();
  if (!code) return;
  await network.joinRoom(code);
  addKillfeed(`JOINED · ${network.roomId}`);
  updateRoomHud();
});
mapSelectEl?.addEventListener('change', () => {
  renderer.setMap(mapSelectEl.value);
  player.boxes = renderer.getBoxes();
  player.grenadeSystem.boxes = renderer.getBoxes();
  player.pos.set(0, 1, 5);
  addKillfeed(`MAP · ${mapSelectEl.options[mapSelectEl.selectedIndex].textContent}`);
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
    { nick: network.nickname, kills: network.kills, deaths: network.deaths, rating: network.rating, isMe: true },
    ...Object.values(network.otherPlayers).map(p => ({
      nick:   p.nickname || '???',
      kills:  p.kills  || 0,
      deaths: p.deaths || 0,
      rating: p.rating || 0,
      isMe:   false,
    }))
  ];

  // 킬 순 정렬
  allPlayers.sort((a,b) => b.kills - a.kills);

  allPlayers.forEach((p, i) => {
    const kd = p.deaths === 0 ? p.kills.toFixed(1) : (p.kills/p.deaths).toFixed(2);
    const tier = getRatingTier(p.rating || 0);
    const row = document.createElement('div');
    row.className = 'sb-row' + (p.isMe ? ' sb-me' : '');
    row.innerHTML = `
      <span class="sb-rank">#${i+1}</span>
      <span class="sb-nick">${p.isMe ? '▶ ' : ''}${p.nick}</span>
      <span class="sb-kills">${p.kills}</span>
      <span class="sb-deaths">${p.deaths}</span>
      <span class="sb-kd" style="color:${tier.color}">${tier.name} · ${kd}</span>
    `;
    rows.appendChild(row);
  });
}

// ── HUD ──
function updateHud() {
  player._syncWeaponStats();
  const weapon = player.getLoadoutWeapon();
  const weaponState = player.getLoadoutState();
  const hp  = player.health;
  const pct = hp / player.maxHealth;
  healthFill.style.width = (pct * 100) + '%';
  healthNum.textContent  = hp;

  healthFill.className = '';
  if      (pct <= 0.3) { healthFill.classList.add('crit'); healthNum.style.color = '#ff3c3c'; }
  else if (pct <= 0.6) { healthFill.classList.add('warn'); healthNum.style.color = '#ffcc00'; }
  else                 { healthNum.style.color = ''; }

  if (player.weaponSlot === 1 || player.weaponSlot === 2 || player.weaponSlot === 5) {
    ammoCurrentEl.textContent = weaponState.ammo;
    ammoMaxEl.textContent     = '/ ' + weapon.maxAmmo + '  [' + weaponState.reserve + ']';
    ammoMode.textContent      = weaponState.reloading ? '[RELOADING...]' : `[${weapon.mode}] ${weapon.name}`;
    ammoCurrentEl.classList.toggle('sniper-ammo', !!weapon.scope);
  } else if (player.weaponSlot === 4) {
    ammoCurrentEl.textContent = '💣 ' + player.grenadeCount;
    ammoMaxEl.textContent     = '/ 3';
    const charge = Math.round((player.grenadeCharge / player.grenadeMaxCharge) * 100);
    ammoMode.textContent      = player.isChargingGrenade ? `[CHARGE ${charge}%]` : '[GRENADE]';
    ammoCurrentEl.classList.remove('sniper-ammo');
  } else if (player.weaponSlot === 3) {
    ammoCurrentEl.textContent = 'BANDAGE';
    ammoMaxEl.textContent     = `× ${player.bandageCount}`;
    ammoMode.textContent      = isAtBase() ? '[BASE HEAL]' : '[BASE ONLY]';
    ammoCurrentEl.classList.remove('sniper-ammo');
  }
  reloadBar.classList.toggle('blocked', !isAtBase() && player.weaponSlot !== 4);
  updateTierHud();
  updateMatchHud();
  reloadBar.classList.toggle('visible', player.isReloading || player.sniperReloading || player.pistolReloading || !!weaponState.reloading);
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

function pulseHitEffect(isHeadshot = false) {
  document.body.classList.remove('hit-kick', 'headshot-kick');
  void document.body.offsetWidth;
  document.body.classList.add(isHeadshot ? 'headshot-kick' : 'hit-kick');
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
// 기본 데미지 (M4A1 기준)
const HITBOXES = [
  { name:'HEAD', offsetY:1.95, halfH:0.31, radius:0.34, rifle:20, sniper:100 },
  { name:'BODY', offsetY:1.25, halfH:0.42, radius:0.47, rifle:10, sniper:40 },
  { name:'LEGS', offsetY:0.45, halfH:0.52, radius:0.35, rifle: 5, sniper:25 },
];

// 무기별 데미지 테이블
const WEAPON_DAMAGE = {
  rifle:  { HEAD: 20, BODY: 10, LEGS:  5 },
  sniper: { HEAD:100, BODY: 40, LEGS: 40 },
  pistol: { HEAD: 30, BODY: 20, LEGS: 10 },
};
for (const weapon of WEAPON_CATALOG) WEAPON_DAMAGE[weapon.id] = weapon.damage;

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

function checkHit(weaponType = 'rifle') {
  const origin = camCtrl.getHeadPos();
  const front  = camCtrl.getFront();
  const weaponKey = player.getWeaponKey();
  let bestDist=200, hitTarget=null, hitDamage=0, hitPart='';
  let hitPoint = null;

  // 벽까지의 거리 — 이보다 멀리 있는 플레이어는 맞지 않음
  const wallDist = wallBlockDist(origin, front);
  const dmgTable = WEAPON_DAMAGE[weaponType] || WEAPON_DAMAGE.rifle;

  for (const [pid, info] of Object.entries(network.otherPlayers)) {
    if (!info?.pos) continue;
    const base = new THREE.Vector3(info.pos[0], info.pos[1], info.pos[2]);
    for (const hb of HITBOXES) {
      const center = base.clone(); center.y += hb.offsetY;
      const t = rayVsCapsule(origin, front, center, hb.halfH, hb.radius);
      if (t < bestDist && t < wallDist) {
        bestDist = t; hitTarget = pid;
        hitDamage = dmgTable[hb.name] ?? hb.damage;
        hitPart = hb.name;
        hitPoint = origin.clone().addScaledVector(front, t);
      }
    }
  }

  if (hitTarget) {
    network.sendHit(hitTarget, hitDamage, weaponType);
    showHitmarker(hitPart === 'HEAD');
    pulseHitEffect(hitPart === 'HEAD');
    if (hitPoint) renderer.spawnBulletImpact(hitPoint, hitPart === 'HEAD');
    const icon = hitPart==='HEAD' ? 'HEAD' : hitPart==='BODY' ? 'BODY' : 'LEG';
    const targetNick = network.otherPlayers[hitTarget]?.nickname || hitTarget.slice(-4);
    addKillfeed(`${icon} ${hitPart} +${hitDamage} → ${targetNick}`);
  }
}

function isAtBase() {
  return player.pos.distanceTo(BASE_CENTER) <= BASE_RADIUS;
}

function updateTierHud() {
  if (!tierNameEl || !tierRatingEl || !tierBadgeEl) return;
  const tier = getRatingTier(network.rating);
  tierNameEl.textContent = tier.name;
  tierRatingEl.textContent = `${network.rating} RP`;
  const badgeText = tier.name === '챌린저' ? 'C' : (tier.name.split(' ')[1] || 'V');
  const badgeInner = tierBadgeEl.querySelector('span');
  if (badgeInner) badgeInner.textContent = badgeText;
  tierBadgeEl.style.borderColor = tier.color;
  tierBadgeEl.style.color = tier.color;
  tierBadgeEl.style.boxShadow = `0 0 18px ${tier.color}55`;
}

function updateMatchHud() {
  if (!matchGoalEl || !matchKillsEl || !matchStatusEl) return;
  matchGoalEl.textContent = `${matchKillLimit} KILLS`;
  matchKillsEl.textContent = `${network.kills}/${matchKillLimit}`;
  const remaining = Math.max(0, matchKillLimit - network.kills);
  matchStatusEl.textContent = matchEnded ? 'VICTORY' : isAtBase() ? `BASE · ${remaining} LEFT` : `${remaining} LEFT`;
  matchStatusEl.classList.toggle('base', isAtBase());
  matchStatusEl.classList.toggle('victory', matchEnded);
}

function updateRoomHud(meta = null) {
  const room = meta || {
    id: network.roomId,
    limit: network.matchLimit,
    status: network.roomStatus,
    winner: network.roomWinner,
  };
  if (roomCodeEl) roomCodeEl.textContent = `ROOM ${room.id}`;
  if (roomStatusEl) {
    const winner = room.winner ? ` · WINNER ${room.winner}` : '';
    roomStatusEl.textContent = `${String(room.status || 'waiting').toUpperCase()} · ${room.limit} KILLS${winner}`;
  }
  if (matchLimitSelect && Number(matchLimitSelect.value) !== Number(room.limit)) {
    matchLimitSelect.value = String(room.limit);
  }
  matchKillLimit = Number(room.limit || matchKillLimit || 10);
  matchEnded = room.status === 'ended';
  updateMatchHud();
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
player.onShoot     = () => {
  const front = camCtrl.getFront();
  renderer.spawnMuzzleFlash(camCtrl.getHeadPos(), front, player.getLoadoutWeapon().scope);
};
player.onHudUpdate = updateHud;
player.onDie = () => {
  deathScreen.classList.add('active');
  setTimeout(() => deathScreen.classList.remove('active'), 1500);
  network.sendRespawn(player.pos.toArray());
  player.health = 100;
  updateHud();
};

// ── 수류탄 폭발 콜백 (직접 연결, setTimeout 없음) ──
player.grenadeSystem.getContactTargets = () => [
  ...Object.entries(network.otherPlayers)
    .filter(([, info]) => info?.pos)
    .map(([id, info]) => ({ id, pos: new THREE.Vector3(info.pos[0], info.pos[1], info.pos[2]), radius: 0.58, height: 1.8 })),
];

player.grenadeSystem.onExplode = (pos, radius, maxDamage, meta = {}) => {
  // 내 위치 기준 화면 흔들림
  const myCenter = player.pos.clone(); myCenter.y += 0.9;
  const myDist = myCenter.distanceTo(pos);
  if (myDist < radius * 1.5) {
    dmgFlash.classList.add('active');
    setTimeout(() => dmgFlash.classList.remove('active'), myDist < 3 ? 400 : 150);
  }
  if (myDist < radius) {
    const falloff = Math.max(0, 1 - (myDist / radius));
    const selfDmg = Math.round(maxDamage * falloff * falloff * 0.75);
    if (selfDmg > 0) {
      player.health = Math.max(0, player.health - selfDmg);
      player.applyKnockback(pos, 1.8 + falloff * 4.2);
      addKillfeed(`GRENADE SELF ${selfDmg}`);
    }
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
  addKillfeed(meta.contact ? 'CONTACT EXPLOSION!' : 'EXPLOSION!');
  updateHud();
};

player.onBandageUsed = () => {
  addKillfeed('🩹 붕대 사용 완료! +30 HP');
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
  pulseHitEffect(false);
  setTimeout(() => dmgFlash.classList.remove('active'), 150);
};

network.onRoomUpdate = (room) => {
  updateRoomHud(room);
  if (room.status === 'ended' && room.winner) {
    matchEnded = true;
  }
};

network.onKill = (targetId, kills, deaths) => {
  const targetNick = network.otherPlayers[targetId]?.nickname || targetId.slice(-4);
  addKillfeed(`☠️ ${network.nickname} → ${targetNick}`, true);
  if (kills >= matchKillLimit && !matchEnded) {
    matchEnded = true;
    addKillfeed(`MATCH WIN · ${matchKillLimit} KILLS`, true);
  }
  updateHud();
};

// ── 채팅 ──
const _seenChatTs = new Set();

function addChatMessage({ uid, nickname, text, ts }) {
  // 중복 방지
  const key = `${uid}_${ts}`;
  if (_seenChatTs.has(key)) return;
  _seenChatTs.add(key);

  const isMe = uid === network.myUid;
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isMe ? ' chat-mine' : '');
  div.innerHTML = `<span class="chat-nick">${escapeHtml(nickname)}</span>${escapeHtml(text)}`;
  chatMessagesEl.appendChild(div);

  // 최대 30개 유지
  while (chatMessagesEl.children.length > 30) {
    chatMessagesEl.removeChild(chatMessagesEl.firstChild);
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  // 8초 후 자동 제거
  setTimeout(() => div.remove(), 8000);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let _chatOpen = false;

function openChat() {
  _chatOpen = true;
  chatInputWrapEl.classList.add('active');
  document.exitPointerLock?.();
  setTimeout(() => chatInputEl.focus(), 30);
}

function closeChat() {
  _chatOpen = false;
  chatInputWrapEl.classList.remove('active');
  chatInputEl.value = '';
}

function submitChat() {
  const text = chatInputEl.value.trim();
  if (text) network.sendChat(text);
  closeChat();
}

// T키로 채팅 열기
window.addEventListener('keydown', e => {
  if (_chatOpen) return;
  if (e.code === 'KeyT' && !e.repeat) {
    e.preventDefault();
    openChat();
  }
});

// 채팅창 키 처리
chatInputEl.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Enter') { e.preventDefault(); submitChat(); }
  if (e.code === 'Escape') { e.preventDefault(); closeChat(); }
});

// 채팅 수신 시작
network.listenChat(addChatMessage);

// ── 메인 루프 ──
// ── 메인 루프 ──
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  // FPS 측정 (0.5초마다 갱신)
  _fpsFrames++;
  _fpsAccum += dt;
  if (_fpsAccum >= 0.5) {
    _fpsValue = Math.round(_fpsFrames / _fpsAccum);
    _fpsFrames = 0;
    _fpsAccum  = 0;
    if (fpsDisplayEl) {
      fpsDisplayEl.textContent = `${_fpsValue} FPS`;
      fpsDisplayEl.style.color = _fpsValue >= 50 ? '#00ffe0' : _fpsValue >= 30 ? '#ffcc00' : '#ff4444';
    }
    if (pingDisplayEl) {
      pingDisplayEl.textContent = `${_pingValue} ms`;
      pingDisplayEl.style.color = _pingValue < 80 ? '#00ffe0' : _pingValue < 150 ? '#ffcc00' : '#ff4444';
    }
  }

  if (isLocked()) {
    player.update(camCtrl, checkHit, dt);
    camCtrl.update(player.pos, player.isSliding, player.bobAmp,
                   player.moveTime, player.isJumping, player.currentRoll);

    adsVignette.style.opacity = player.adsProgress;

    // 저격 스코프 FOV
    const speedPulse = player.speedBoost + (player.isSliding ? 0.045 : 0);
    camCtrl.setFovFromScope(player.getLoadoutWeapon().scope ? player.scopeProgress : 0, speedPulse);
    document.body.classList.toggle('speeding', speedPulse > 0.025);

    if (hitmarkerTimer > 0) {
      hitmarkerTimer -= dt * 1000;
      if (hitmarkerTimer <= 0) hitmarker.classList.remove('active');
    }

    if (player.isReloading) {
      reloadFill.style.width = ((1 - player.reloadTimer/player.reloadDuration)*100) + '%';
    } else if (player.getLoadoutState()?.reloading) {
      const state = player.getLoadoutState();
      const weapon = player.getLoadoutWeapon();
      reloadFill.style.width = ((1 - state.reloadTimer / weapon.reload) * 100) + '%';
    }
    if (player.isBandaging) {
      bandageFill.style.width = ((1 - player.bandageTimer/player.bandageDuration)*100) + '%';
      bandageBar.classList.add('visible');
    } else {
      bandageBar.classList.remove('visible');
    }

    renderer.updateParticles(dt);
  }

  // 포인터 락 여부와 무관하게 항상 위치 전송 (상대방에게 보이기 위함)
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
    slot2El && slot2El.classList.toggle('active', player.weaponSlot === 2);
    slot5El && slot5El.classList.toggle('active', player.weaponSlot === 5);
    slot4El.classList.toggle('active', player.weaponSlot === 4);
    slot3El.classList.toggle('active', player.weaponSlot === 3);
    if (grenadeCountUI) grenadeCountUI.textContent = `×${player.grenadeCount}`;
    if (bandageCountUI) bandageCountUI.textContent = `×${player.bandageCount}`;
    if (sniperCountUI)  sniperCountUI.textContent  = player.getLoadoutWeapon(2).icon;
    if (pistolCountUI)  pistolCountUI.textContent  = player.getLoadoutWeapon(5).icon;
  }

  // ── 저격 스코프 오버레이 ──
  const scopeOn = player.getLoadoutWeapon().scope && player.scopeProgress > 0.05;
  sniperScopeEl.style.display = scopeOn ? 'block' : 'none';
  if (scopeOn) {
    const W = window.innerWidth, H = window.innerHeight;
    if (scopeCanvas.width !== W || scopeCanvas.height !== H) {
      scopeCanvas.width = W; scopeCanvas.height = H;
    }
    const ctx2 = scopeCanvas.getContext('2d');
    ctx2.clearRect(0,0,W,H);
    const alpha = player.scopeProgress;
    const cx = W/2, cy = H/2;
    const r  = Math.min(W,H) * 0.32 * alpha;
    // 검은 테두리 (비네트)
    ctx2.fillStyle = `rgba(0,0,0,${0.92 * alpha})`;
    ctx2.fillRect(0,0,W,H);
    // 스코프 원형 투명 영역
    ctx2.save();
    ctx2.globalCompositeOperation = 'destination-out';
    ctx2.beginPath();
    ctx2.arc(cx, cy, r, 0, Math.PI*2);
    ctx2.fillStyle = 'rgba(0,0,0,1)';
    ctx2.fill();
    ctx2.restore();
    // 십자선
    ctx2.strokeStyle = `rgba(0,255,100,${0.8*alpha})`;
    ctx2.lineWidth = 1.5;
    ctx2.beginPath();
    ctx2.moveTo(cx - r*0.9, cy); ctx2.lineTo(cx - r*0.15, cy);
    ctx2.moveTo(cx + r*0.15, cy); ctx2.lineTo(cx + r*0.9, cy);
    ctx2.moveTo(cx, cy - r*0.9); ctx2.lineTo(cx, cy - r*0.15);
    ctx2.moveTo(cx, cy + r*0.15); ctx2.lineTo(cx, cy + r*0.9);
    ctx2.stroke();
    // 중심점
    ctx2.beginPath();
    ctx2.arc(cx, cy, 2, 0, Math.PI*2);
    ctx2.fillStyle = `rgba(0,255,100,${alpha})`;
    ctx2.fill();
    // 스코프 원 테두리
    ctx2.strokeStyle = `rgba(40,40,40,${alpha})`;
    ctx2.lineWidth = 3;
    ctx2.beginPath();
    ctx2.arc(cx, cy, r, 0, Math.PI*2);
    ctx2.stroke();
  }

  renderer.render(renderer.camera);
}  // ← loop 함수의 닫는 중괄호는 여기에만 있어야 합니다

updateHud();
playerCountEl.textContent = 'PLAYERS: 1';
loop();

function renderLoadoutUi() {
  if (!loadoutGridEl || !loadoutSlotsEl) return;
  loadoutGridEl.innerHTML = '';
  loadoutSlotsEl.innerHTML = '';
  const loadout = normalizeLoadout(player.loadoutIds);
  ['slot-1', 'slot-2', 'slot-5'].forEach((slotId, i) => {
    const slotEl = document.getElementById(slotId);
    const weapon = getWeaponById(loadout[i]);
    slotEl?.querySelector('.weapon-icon') && (slotEl.querySelector('.weapon-icon').textContent = weapon.icon);
    slotEl?.querySelector('.slot-name') && (slotEl.querySelector('.slot-name').textContent = weapon.name);
  });
  loadout.forEach((id, i) => {
    const weapon = getWeaponById(id);
    const slot = document.createElement('div');
    slot.className = 'loadout-slot';
    slot.textContent = `${i + 1}. ${weapon.name}`;
    slot.style.borderColor = weapon.color;
    loadoutSlotsEl.appendChild(slot);
  });
  for (const weapon of WEAPON_CATALOG) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'loadout-choice' + (loadout.includes(weapon.id) ? ' selected' : '');
    btn.style.setProperty('--weapon-color', weapon.color);
    btn.textContent = `${weapon.icon} ${weapon.name}`;
    btn.addEventListener('click', e => {
      e.preventDefault();
      let next = normalizeLoadout(player.loadoutIds);
      if (next.includes(weapon.id)) {
        if (next.length > 1) next = next.filter(id => id !== weapon.id);
      } else {
        next.push(weapon.id);
        if (next.length > 3) next.shift();
      }
      player.setLoadout(next);
      renderLoadoutUi();
      updateHud();
    });
    loadoutGridEl.appendChild(btn);
  }
}

if (mapSelectEl) mapSelectEl.value = renderer.mapId;
renderLoadoutUi();
