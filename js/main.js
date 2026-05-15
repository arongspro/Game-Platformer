// main.js - Game loop, HUD, session check, kill feed, name tags

import * as THREE from 'three';
import { Renderer }         from './renderer.js';
import { CameraController } from './camera.js';
import { Player }           from './player.js';
import { Network }          from './network.js';
import { getRatingTier }    from './ranks.js';
import { WEAPON_CATALOG, getWeaponById, normalizeLoadout } from './weapons.js';

// ── Session check (redirect to login.html if not logged in) ──
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

// FPS / Ping measurement
let _fpsFrames = 0, _fpsAccum = 0, _fpsValue = 0;
let _pingValue = 0;
function _measurePing() {
  const start = Date.now();
  fetch('https://firebasestorage.googleapis.com/favicon.ico', { mode: 'no-cors', cache: 'no-store' })
    .then(() => { _pingValue = Date.now() - start; })
    .catch(() => {});
}
setInterval(_measurePing, 5000);
_measurePing();


const BASE_CENTER = new THREE.Vector3(0, 1, 5);
const BASE_RADIUS = 17;
const storedLimit = Number(localStorage.getItem('vp_match_limit') || 10);
let matchKillLimit = storedLimit === 20 ? 20 : 10;
let matchEnded = false;
if (matchLimitSelect) matchLimitSelect.value = String(matchKillLimit);

// Display nickname
myNickEl.textContent = userInfo.nickname;

// ── Initialisation ──
const renderer = new Renderer(canvas);
const camCtrl  = new CameraController(renderer.camera);
const player   = new Player(renderer.getBoxes(), renderer);
const network  = new Network(userInfo);
player.canUseBaseAction = () => isAtBase();

// Apply local player pixel character
setTimeout(() => {
  if (userInfo.pixels) player.applyPixels(userInfo.pixels);
}, 500);

const remoteMeshes = {};
const clock = new THREE.Clock();

// ── Pointer lock ──
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
  // Don't show lock overlay while chat is open
  if (_chatOpen) { lockOverlay.style.display = 'none'; return; }
  lockOverlay.style.display = isLocked() ? 'none' : 'flex';
}
document.addEventListener('pointerlockchange',       onPointerLockChange);
document.addEventListener('mozpointerlockchange',    onPointerLockChange);
document.addEventListener('webkitpointerlockchange', onPointerLockChange);
document.addEventListener('pointerlockerror', () => console.warn('Pointer lock failed'));

// ── Mouse / Keys ──
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

// ── Scoreboard (TAB) ──
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

  // My info
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

  // Sort by kills
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

function updateHud() {
  player._syncWeaponStats();
  const weapon      = player.getLoadoutWeapon();
  const weaponState = player.getLoadoutState();
  const slot        = player.weaponSlot;
  const hp          = player.health;
  const pct         = hp / player.maxHealth;

  healthFill.style.width = (pct * 100) + '%';
  healthNum.textContent  = hp;
  healthFill.className   = pct <= 0.3 ? 'crit' : pct <= 0.6 ? 'warn' : '';
  healthNum.style.color  = pct <= 0.3 ? '#ff3c3c' : pct <= 0.6 ? '#ffcc00' : '';

  if (slot === 1 || slot === 2 || slot === 5) {
    ammoCurrentEl.textContent = weaponState.ammo;
    ammoMaxEl.textContent     = `/ ${weapon.maxAmmo}  [${weaponState.reserve}]`;
    ammoMode.textContent      = weaponState.reloading ? '[RELOADING...]' : `[${weapon.mode}] ${weapon.name}`;
    ammoCurrentEl.classList.toggle('sniper-ammo', !!weapon.scope);
  } else if (slot === 4) {
    ammoCurrentEl.textContent = '💣 ' + player.grenadeCount;
    ammoMaxEl.textContent     = '/ 3';
    const charge = Math.round((player.grenadeCharge / player.grenadeMaxCharge) * 100);
    ammoMode.textContent      = player.isChargingGrenade ? `[CHARGE ${charge}%]` : '[GRENADE]';
    ammoCurrentEl.classList.remove('sniper-ammo');
  } else if (slot === 3) {
    ammoCurrentEl.textContent = 'BANDAGE';
    ammoMaxEl.textContent     = `× ${player.bandageCount}`;
    ammoMode.textContent      = isAtBase() ? '[BASE HEAL]' : '[BASE ONLY]';
    ammoCurrentEl.classList.remove('sniper-ammo');
  }

  reloadBar.classList.toggle('blocked',  !isAtBase() && slot !== 4);
  reloadBar.classList.toggle('visible',  player.isReloading || player.sniperReloading || player.pistolReloading || player.rpgReloading || !!weaponState.reloading);
  bandageBar.classList.toggle('visible', player.isBandaging);

  const invincible = network.isInvincible();
  if (invincible) {
    const remainMs = 3000 - (Date.now() - network._respawnTime);
    dashCdEl.classList.add('visible');
    dashCdEl.textContent = `🛡️ INVINCIBLE ${(remainMs / 1000).toFixed(1)}s`;
    dashCdEl.style.color = '#00ffe0';
  } else {
    dashCdEl.style.color = '';
    dashCdEl.classList.toggle('visible', player.dashCooldown > 0);
    if (player.dashCooldown > 0)
      dashCdEl.textContent = `DASH CD: ${Math.ceil(player.dashCooldown / 60)}s`;
  }

  updateTierHud();
  updateMatchHud();
}

// ── Hitmarker ──
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

// ── Kill feed ──
function addKillfeed(text, isKill = false) {
  const el = document.createElement('div');
  el.className   = 'killfeed-entry' + (isKill ? ' killfeed-kill' : '');
  el.textContent = text;
  killfeed.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Per-part hitbox raycast ──
// Base damage (M4A1 reference)
const HITBOXES = [
  { name:'HEAD', offsetY:1.95, halfH:0.31, radius:0.34, rifle:20, sniper:100 },
  { name:'BODY', offsetY:1.25, halfH:0.42, radius:0.47, rifle:10, sniper:40 },
  { name:'LEGS', offsetY:0.45, halfH:0.52, radius:0.35, rifle: 5, sniper:25 },
];

// Per-weapon damage table
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

// Ray vs AABB box intersection distance (Infinity if no hit)
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

// Check if ray is blocked by map wall - return nearest wall distance
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

  // Wall distance — players beyond this cannot be hit
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
  // Use XZ-plane distance only — jumping shouldn't push player out of base
  const dx = player.pos.x - BASE_CENTER.x;
  const dz = player.pos.z - BASE_CENTER.z;
  return Math.sqrt(dx*dx + dz*dz) <= BASE_RADIUS;
}

function updateTierHud() {
  if (!tierNameEl || !tierRatingEl || !tierBadgeEl) return;
  const tier = getRatingTier(network.rating);
  tierNameEl.textContent = tier.name;
  tierRatingEl.textContent = `${network.rating} RP`;
  const badgeText = tier.name === 'Challenger' ? 'C' : (tier.name.split(' ')[1] || 'V');
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

// ── Supply crates ──
const CRATE_INTERACT_DIST = 3.5;

// Crate positions per platform [x, y, z]
// Centre of each platform, behind structures if present
// 1) Spawn (y=1): behind corner pillar
// 2) Stair platform (y=6): behind left tower (x=-13,z=42)
// 3) Mid platform (y=13.5): behind cube (0,15,99)
// 4) Top platform (y=24): behind large cube (0,25,152)
const CRATE_DEFS = [
  { pos: new THREE.Vector3(  0,  2.2,   0) },   // Spawn: original position
  { pos: new THREE.Vector3(  0,  6.6,  35) },   // Stair platform centre
  { pos: new THREE.Vector3(  0, 14.6, 102) },   // Mid platform: behind cube
  { pos: new THREE.Vector3(  0, 24.6, 156) },   // Top platform: behind large cube
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

// Crate builder
function buildCrate(pos) {
  const group = new THREE.Group();
  group.position.copy(pos);

  // Body
  const mat  = new THREE.MeshLambertMaterial({ color: 0x997733 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  // Cross mark (top face)
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const cV = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.55), crossMat);
  const cH = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.15), crossMat);
  cV.position.y = cH.position.y = 0.62;
  group.add(cV, cH);

  renderer.scene.add(group);

  // Label sprite
  const label = makeELabel();
  label.position.copy(pos);
  label.position.y += 1.6;
  renderer.scene.add(label);

  return { group, mesh, mat, label, pos };
}

const crates = CRATE_DEFS.map(d => buildCrate(d.pos));

// E key interaction
window.addEventListener('keydown', e => {
  if (e.code !== 'KeyE') return;
  // Ignore if all ammo and grenades are full
  const isFull = player.ammo === player.maxAmmo &&
                 player.totalAmmo === player.maxTotalAmmo &&
                 player.grenadeCount === player.maxGrenades &&
                 player.bandageCount === player.maxBandage;
  if (isFull) return;

  for (const crate of crates) {
    if (player.pos.distanceTo(crate.pos) <= CRATE_INTERACT_DIST) {
      player.refillFromCrate();
      addKillfeed('📦 Resupplied! Ammo + Grenades refilled');
      crate.mat.color.set(0x00ff88);
      setTimeout(() => crate.mat.color.set(0x997733), 300);
      break;
    }
  }
});

// ── Callback bindings ──
player.onShoot     = () => {
  const front = camCtrl.getFront();
  renderer.spawnMuzzleFlash(camCtrl.getHeadPos(), front, player.getLoadoutWeapon().scope);
};
player.onHudUpdate = updateHud;
player.onDie = () => {
  deathScreen.classList.add('active');
  setTimeout(() => {
    deathScreen.classList.remove('active');
    // 죽고 나서 자동으로 포인터락 재획득 시도
    tryLock();
  }, 1500);
  network.sendRespawn(player.pos.toArray());
  // health reset은 player.js 내부에서 이미 처리 — 중복 제거
  updateHud();
};

// ── Grenade explosion callback ──
player.grenadeSystem.getContactTargets = () => [
  ...Object.entries(network.otherPlayers)
    .filter(([, info]) => info?.pos)
    .map(([id, info]) => ({ id, pos: new THREE.Vector3(info.pos[0], info.pos[1], info.pos[2]), radius: 0.58, height: 1.8 })),
];

player.grenadeSystem.onExplode = (pos, radius, maxDamage, meta = {}) => {
  // Screen shake based on my position
  const myCenter = player.pos.clone(); myCenter.y += 0.9;
  const myDist = myCenter.distanceTo(pos);
  if (myDist < radius * 1.5) {
    dmgFlash.classList.add('active');
    setTimeout(() => dmgFlash.classList.remove('active'), myDist < 3 ? 400 : 150);
  }
  if (myDist < radius) {
    const falloff = Math.max(0, 1 - (myDist / radius));
    const selfDmg = Math.round(maxDamage * falloff * falloff * 0.5); // reduced from 0.75
    if (selfDmg > 0) {
      player.health = Math.max(0, player.health - selfDmg);
      player.applyKnockback(pos, 2.5 + falloff * 5.5); // stronger knockback for grenade jump
      addKillfeed(`GRENADE SELF ${selfDmg}`);
    }
  }

  // Damage other players
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
  addKillfeed('🩹 Bandage used! +30 HP');
  updateHud();
};

// ── RPG 로켓 콜백 ──

// 로켓이 플레이어 히트박스에 닿았는지 매 프레임 체크
player.onRocketHitCheck = (prevPos, nextPos) => {
  const seg = nextPos.clone().sub(prevPos);
  const segLen = seg.length();
  if (segLen < 0.001) return null;
  const segDir = seg.clone().normalize();

  for (const [pid, info] of Object.entries(network.otherPlayers)) {
    if (!info?.pos) continue;
    const base = new THREE.Vector3(info.pos[0], info.pos[1], info.pos[2]);
    // HEAD 히트박스 먼저 (데미지 60)
    for (const hb of HITBOXES) {
      const center = base.clone(); center.y += hb.offsetY;
      const t = rayVsCapsule(prevPos, segDir, center, hb.halfH, hb.radius);
      if (t >= 0 && t <= segLen) {
        const dmg = hb.name === 'HEAD' ? 60 : 40;
        network.sendHit(pid, dmg, 'rpg');
        showHitmarker(hb.name === 'HEAD');
        const targetNick = info.nickname || pid.slice(-4);
        addKillfeed(`🚀 RPG ${hb.name} +${dmg} → ${targetNick}`);
        return { pid, dmg, part: hb.name };
      }
    }
  }
  return null;
};

// 로켓 폭발 처리
player.onRocketExplode = (pos, hitPlayer = false) => {
  // 폭발 비주얼
  renderer.spawnRocketExplosion(pos);

  // 화면 흔들림
  const myCenter = player.pos.clone(); myCenter.y += 0.9;
  const myDist   = myCenter.distanceTo(pos);
  const RADIUS   = 8.0;
  if (myDist < RADIUS * 1.5) {
    dmgFlash.classList.add('active');
    setTimeout(() => dmgFlash.classList.remove('active'), myDist < 3 ? 500 : 180);
  }

  // 자기 자신 범위 피해 (벽 충돌 시에만, 직격은 이미 hitPlayer=true)
  if (!hitPlayer && myDist < RADIUS) {
    const falloff = Math.max(0, 1 - (myDist / RADIUS));
    const selfDmg = Math.round(40 * falloff * falloff * 0.6);
    if (selfDmg > 0) {
      player.health = Math.max(0, player.health - selfDmg);
      player.applyKnockback(pos, 3.0 + falloff * 6.0);
      addKillfeed(`🚀 RPG SELF ${selfDmg}`);
    }
  }

  // 근처 다른 플레이어 범위 피해 (직격이 아닌 경우)
  if (!hitPlayer) {
    for (const [pid, info] of Object.entries(network.otherPlayers)) {
      if (!info?.pos) continue;
      const tPos = new THREE.Vector3(info.pos[0], info.pos[1] + 0.9, info.pos[2]);
      const dist = tPos.distanceTo(pos);
      if (dist < RADIUS) {
        const falloff = Math.max(0, 1 - (dist / RADIUS));
        const dmg = Math.round(40 * falloff * falloff);
        if (dmg > 0) {
          network.sendHit(pid, dmg, 'rpg');
          showHitmarker(false);
          const targetNick = info.nickname || pid.slice(-4);
          addKillfeed(`🚀 RPG SPLASH ${dmg} → ${targetNick}`);
        }
      }
    }
  }

  addKillfeed(hitPlayer ? '🚀 DIRECT HIT!' : '🚀 EXPLOSION!');
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
  // Bug fix: 붕대 사용 중에 network hp로 덮어쓰면 힐 효과가 사라짐 → 무시
  if (player.isBandaging) return;
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

// ── Chat ──
const _seenChatTs = new Set();

function addChatMessage({ uid, nickname, text, ts }) {
  // Dedup
  const key = `${uid}_${ts}`;
  if (_seenChatTs.has(key)) return;
  _seenChatTs.add(key);

  const isMe = uid === network.myUid;
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isMe ? ' chat-mine' : '');
  div.innerHTML = `<span class="chat-nick">${escapeHtml(nickname)}</span>${escapeHtml(text)}`;
  chatMessagesEl.appendChild(div);

  // Keep max 30 messages
  while (chatMessagesEl.children.length > 30) {
    chatMessagesEl.removeChild(chatMessagesEl.firstChild);
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  // Auto-remove after 8s
  setTimeout(() => div.remove(), 8000);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let _chatOpen = false;

function openChat() {
  _chatOpen = true;
  chatInputWrapEl.classList.add('active');
  // Release pointer lock so mouse is visible for typing
  // but keep canvas interactive via CSS
  document.exitPointerLock?.();
  // Prevent the lock overlay from appearing immediately
  lockOverlay.style.display = 'none';
  setTimeout(() => chatInputEl.focus(), 30);
}

function closeChat() {
  _chatOpen = false;
  chatInputWrapEl.classList.remove('active');
  chatInputEl.value = '';
  chatInputEl.blur();
  // Re-acquire pointer lock automatically
  onPointerLockChange();
  tryLock();
}

function submitChat() {
  const text = chatInputEl.value.trim();
  if (text) network.sendChat(text);
  closeChat();
}

// T key to open chat
window.addEventListener('keydown', e => {
  if (_chatOpen) return;
  if (e.code === 'KeyT' && !e.repeat) {
    e.preventDefault();
    openChat();
  }
});

// Chat input key handling
chatInputEl.addEventListener('keydown', e => {
  e.stopPropagation();
  e.stopImmediatePropagation();
  // e.code can be unreliable on some Korean/IME keyboards — use e.key as fallback
  const isEnter  = e.code === 'Enter'  || e.key === 'Enter';
  const isEscape = e.code === 'Escape' || e.key === 'Escape';
  if (isEnter)  { e.preventDefault(); submitChat(); return; }
  if (isEscape) { e.preventDefault(); closeChat();  return; }
});

// Start chat listener
network.listenChat(addChatMessage);

// ── Main loop ──
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  // FPS counter (update every 0.5s)
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

  // 물리/입력은 포인터락 여부와 무관하게 항상 실행 (죽어도 멈추지 않음)
  player.update(camCtrl, isLocked() ? checkHit : null, dt);
  camCtrl.update(player.pos, player.isSliding, player.bobAmp,
                 player.moveTime, player.isJumping, player.currentRoll);

  if (isLocked()) {
    adsVignette.style.opacity = player.adsProgress;

    const weapon      = player.getLoadoutWeapon();
    const weaponState = player.getLoadoutState();
    const speedPulse  = player.speedBoost + (player.isSliding ? 0.045 : 0);
    camCtrl.setFovFromScope(weapon.scope ? player.scopeProgress : 0, speedPulse);
    document.body.classList.toggle('speeding', speedPulse > 0.025);

    if (hitmarkerTimer > 0) {
      hitmarkerTimer -= dt * 1000;
      if (hitmarkerTimer <= 0) hitmarker.classList.remove('active');
    }

    if (player.isReloading) {
      reloadFill.style.width = ((1 - player.reloadTimer / player.reloadDuration) * 100) + '%';
    } else if (player.rpgReloading) {
      reloadFill.style.width = ((1 - player.rpgReloadTimer / player.rpgReloadDur) * 100) + '%';
    } else if (weaponState?.reloading) {
      reloadFill.style.width = ((1 - weaponState.reloadTimer / weapon.reload) * 100) + '%';
    }

    if (player.isBandaging) {
      bandageFill.style.width = ((1 - player.bandageTimer / player.bandageDuration) * 100) + '%';
      bandageBar.classList.add('visible');
    } else {
      bandageBar.classList.remove('visible');
    }

    renderer.updateParticles(dt);
  }

  // Always send position regardless of pointer lock
  network.sendUpdate(player.getSnapshot(camCtrl));

  // Supply crates
  const isFull = player.ammo === player.maxAmmo &&
                 player.totalAmmo === player.maxTotalAmmo &&
                 player.grenadeCount === player.maxGrenades &&
                 player.bandageCount === player.maxBandage;
  for (const crate of crates) {
    const near = player.pos.distanceTo(crate.pos) <= CRATE_INTERACT_DIST;
    crate.label.visible = near && !isFull;
    crate.group.rotation.y += 0.008;
  }

  // ── Grenade charge bar / slot UI ──
  if (player.weaponSlot === 4 && player.isChargingGrenade) {
    grenadeChargeEl.classList.add('visible');
    const pct = (player.grenadeCharge / player.grenadeMaxCharge) * 100;
    grenadeChargeFill.style.width = pct + '%';
  } else {
    grenadeChargeEl.classList.remove('visible');
  }
  // Slot highlight + weapon names
  if (slot1El && slot4El && slot3El) {
    slot1El.classList.toggle('active', player.weaponSlot === 1);
    slot2El && slot2El.classList.toggle('active', player.weaponSlot === 2);
    slot5El && slot5El.classList.toggle('active', player.weaponSlot === 5);
    slot4El.classList.toggle('active', player.weaponSlot === 4);
    slot3El.classList.toggle('active', player.weaponSlot === 3);
    const slot6El = document.getElementById('slot-6');
    if (slot6El) slot6El.classList.toggle('active', player.weaponSlot === 6);
    if (grenadeCountUI) grenadeCountUI.textContent = `×${player.grenadeCount}`;
    if (bandageCountUI) bandageCountUI.textContent = `×${player.bandageCount}`;
    // Update slot names to show actual weapon names
    const w1 = player.getLoadoutWeapon(1);
    const w2 = player.getLoadoutWeapon(2);
    const w5 = player.getLoadoutWeapon(5);
    const n1 = slot1El.querySelector('.slot-name');
    const n2 = slot2El?.querySelector('.slot-name');
    const n5 = slot5El?.querySelector('.slot-name');
    if (n1) n1.textContent = w1?.name || 'M4A1';
    if (n2) n2.textContent = w2?.name || 'SNIPER';
    if (n5) n5.textContent = w5?.name || 'PISTOL';
    if (sniperCountUI) sniperCountUI.textContent = `×${player.sniperAmmo ?? 5}`;
    if (pistolCountUI) pistolCountUI.textContent = `×${player.pistolAmmo ?? 12}`;
  }

  // ── Sniper scope overlay ──
  const _weapon  = player.getLoadoutWeapon();
  const scopeOn  = _weapon.scope && player.scopeProgress > 0.05;
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
    ctx2.fillStyle = `rgba(0,0,0,${0.92 * alpha})`;
    ctx2.fillRect(0,0,W,H);
    ctx2.save();
    ctx2.globalCompositeOperation = 'destination-out';
    ctx2.beginPath();
    ctx2.arc(cx, cy, r, 0, Math.PI*2);
    ctx2.fillStyle = 'rgba(0,0,0,1)';
    ctx2.fill();
    ctx2.restore();
    ctx2.strokeStyle = `rgba(0,255,100,${0.8*alpha})`;
    ctx2.lineWidth = 1.5;
    ctx2.beginPath();
    ctx2.moveTo(cx - r*0.9, cy); ctx2.lineTo(cx - r*0.15, cy);
    ctx2.moveTo(cx + r*0.15, cy); ctx2.lineTo(cx + r*0.9, cy);
    ctx2.moveTo(cx, cy - r*0.9); ctx2.lineTo(cx, cy - r*0.15);
    ctx2.moveTo(cx, cy + r*0.15); ctx2.lineTo(cx, cy + r*0.9);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.arc(cx, cy, 2, 0, Math.PI*2);
    ctx2.fillStyle = `rgba(0,255,100,${alpha})`;
    ctx2.fill();
    ctx2.strokeStyle = `rgba(40,40,40,${alpha})`;
    ctx2.lineWidth = 3;
    ctx2.beginPath();
    ctx2.arc(cx, cy, r, 0, Math.PI*2);
    ctx2.stroke();
  }

  renderer.render(renderer.camera);
}

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
