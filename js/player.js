// player.js - Player physics/input/weapon + OBJ gun model (m4a1.obj)

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GrenadeSystem } from './grenade.js';
import { WEAPON_CATALOG, normalizeLoadout, getWeaponById } from './weapons.js';

export class Player {
  constructor(boxes, renderer) {
    this.pos    = new THREE.Vector3(0, 1, 5);
    this.yVel   = 0;

    this.playerRadius = 0.4;
    this.playerHeight = 1.8;

    this.baseSpeed = 0.105;
    this.gravity   = -0.017;
    this.jumpStr   = 0.285;
    this.isJumping = false;
    this.speedBoost = 0;
    this.padCooldown = 0;

    // Slide/dash
    this.isSliding       = false;
    this.slideSpeed      = 0;
    this.slideDir        = new THREE.Vector3();
    this.dashCooldown    = 0;
    this.dashCooldownMax = 10;

    // Animation
    this.moveTime    = 0;
    this.bobAmp      = 0;
    this.targetRoll  = 0;
    this.currentRoll = 0;
    this.recoilRoll  = 0;
    this.recoilYaw   = 0;
    this.recoilPitch = 0;

    // Weapon
    this.ammo          = 30;
    this.maxAmmo       = 30;
    this.totalAmmo     = 120;   // Total reserve ammo
    this.maxTotalAmmo  = 120;
    this.isReloading   = false;
    this.reloadTimer   = 0;
    this.reloadDuration = 60;
    this.recoilOffset  = 0;
    this.isAiming      = false;
    this.adsProgress   = 0;
    this.fireMode      = 'AUTO';
    this.fireCooldown  = 0;
    this.fireRate      = 6;
    this.weaponCatalog = WEAPON_CATALOG;
    this.loadoutIds = normalizeLoadout(JSON.parse(localStorage.getItem('vp_loadout') || 'null'));
    this.weaponStates = {};
    for (const weapon of this.weaponCatalog) {
      this.weaponStates[weapon.id] = { ammo: weapon.maxAmmo, reserve: weapon.reserve, cooldown: 0, reloading: false, reloadTimer: 0 };
    }
    this.weaponProfiles = {
      rifle:  { slot: 1, name: 'M4A1',    ammo: 30, reserve: 120, maxAmmo: 30, maxReserve: 120, reload: 60, fireRate: 6, recoil: 0.3 },
      sniper: { slot: 2, name: 'SNIPER',  ammo: 5,  reserve: 25,  maxAmmo: 5,  maxReserve: 25,  reload: 95, fireRate: 44, recoil: 0.85 },
    };
    this.weaponAmmo = {
      rifle:  { ammo: 30, reserve: 120 },
      sniper: { ammo: 5,  reserve: 25 },
    };
    this.mKeyHeld      = false;
    this.mouseLeftHeld = false;

    // Health
    this.health    = 100;
    this.maxHealth = 100;

    this.boxes    = boxes;
    this.renderer = renderer;

    // Weapon slot: 1=M4A1, 2=Sniper, 5=Pistol, 4=Grenade
    this.weaponSlot    = 1;
    this.grenadeCount  = 3;        // Grenade stock
    this.maxGrenades   = 3;        // Max grenades

    // ── Sniper ──
    this.sniperAmmo       = 5;
    this.sniperMaxAmmo    = 5;
    this.sniperTotalAmmo  = 20;
    this.sniperMaxTotal   = 20;
    this.sniperReloading  = false;
    this.sniperReloadTimer = 0;
    this.sniperReloadDur  = 120;
    this.isScopedIn       = false;
    this.scopeProgress    = 0;
    this.sniperFireCd     = 0;     // Fire cooldown
    this.sniperFireRate   = 15;    // 15 frame cooldown
    this._slot2Held       = false;

    // ── Pistol ──
    this.pistolAmmo       = 12;
    this.pistolMaxAmmo    = 12;
    this.pistolTotalAmmo  = 48;
    this.pistolMaxTotal   = 48;
    this.pistolReloading  = false;
    this.pistolReloadTimer = 0;
    this.pistolReloadDur  = 70;    // ~1.2s
    this.pistolFireCd     = 0;
    this.pistolFireRate   = 15;    // Semi-auto cooldown
    this._slot5Held       = false;
    this._spaceHeld       = false;

    // Bandage
    this.bandageCount    = 0;      // Current stock (max 1)
    this.maxBandage      = 1;
    this.isBandaging     = false;
    this.bandageTimer    = 0;
    this.bandageDuration = 90;     // 1.5s (at 60fps base)
    this.grenadeCharge = 0;        // Left-click hold time (0~90 frames)
    this.grenadeMaxCharge = 90;    // Max charge frames
    this.isChargingGrenade = false;
    this._slot4Held   = false;
    this._slot1Held   = false;
    this._slot2Held   = false;
    this._slot3Held   = false;
    this._slot2Held   = false;
    this._slot5Held   = false;

    // RPG
    this.rpgCount       = 1;       // 현재 장탄
    this.maxRpgCount    = 1;
    this.rpgReserve     = 12;      // 예비탄
    this.rpgReloading   = false;
    this.rpgReloadTimer = 0;
    this.rpgReloadDur   = 110;
    this.rpgFireCd      = 0;
    this._slot6Held     = false;
    // 활성 로켓 목록 (로컬 발사)
    this._rockets       = [];

    // Grenade system (requires renderer.scene, init later)
    this.grenadeSystem = null;

    // Input
    this.keys  = {};
    this.mouse = { left: false, right: false };
    this._bindInput();

    // Callbacks
    this.onShoot      = null;
    this.onHudUpdate  = null;
    this.onDie        = null;
    this.onBandageUsed = null;

    // Mesh filled after OBJ load (null until then)
    this._gunMesh1P   = null;
    this._gunMesh3P   = null;
    this._gunLoaded   = false;

    this._buildLocalBody(renderer);

    const wCam = renderer.weaponCamera;

    // ── Build box model helper ──
    const std = (color, rough=0.5, metal=0.8) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

    // ── Weapon group map: id → THREE.Group ──
    this._fpGroups = {};

    // Helper: add group to camera, store in map
    const addGroup = (id, buildFn) => {
      const g = new THREE.Group();
      g.visible = false;
      buildFn(g);
      wCam.add(g);
      this._fpGroups[id] = g;
    };

    // ── m4a1 — OBJ loaded async, group created now ──
    this._fpWeaponGroup = new THREE.Group();
    this._fpWeaponGroup.visible = false;
    wCam.add(this._fpWeaponGroup);
    this._fpGroups['m4a1'] = this._fpWeaponGroup;

    // ── sniper ──
    addGroup('sniper', g => {
      const body   = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, 0.55), std(0x1a1a1a));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.28), std(0x333333, 0.4, 0.9));
      barrel.position.set(0, 0.012, -0.40);
      const scope  = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 8), std(0x111111, 0.3, 0.9));
      scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.052, -0.05);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.11, 0.048), std(0x2a1a0a, 0.9, 0.1));
      grip.position.set(0, -0.082, 0.14);
      const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.15), std(0x1a1a1a));
      stock.position.set(0, 0.005, 0.32);
      g.add(body, barrel, scope, grip, stock);
    });

    // ── pistol ──
    addGroup('pistol', g => {
      const body   = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.095, 0.17), std(0x2a2a2a));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.10), std(0x333333, 0.4, 0.9));
      barrel.position.set(0, 0.018, -0.13);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.115, 0.052), std(0x3a2a1a, 0.9, 0.1));
      grip.position.set(0, -0.098, 0.055);
      const trigger= new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.015), std(0x111111));
      trigger.position.set(0, -0.02, -0.01);
      g.add(body, barrel, grip, trigger);
    });

    // ── smg (VECTOR) — short, wide, futuristic ──
    addGroup('smg', g => {
      const body   = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.075, 0.30), std(0x222222));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.10), std(0x444444, 0.3, 0.9));
      barrel.position.set(0, 0.012, -0.20);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.10, 0.048), std(0x1a1a2a, 0.9, 0.1));
      grip.position.set(0, -0.085, 0.06);
      const mag    = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.06), std(0x333333));
      mag.position.set(0, -0.06, -0.04);
      const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.12), std(0x222222));
      stock.position.set(0, 0, 0.21);
      g.add(body, barrel, grip, mag, stock);
    });

    // ── shotgun (BREACH) — thick, short barrel, pump ──
    addGroup('shotgun', g => {
      const body   = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.45), std(0x3a2a1a, 0.8, 0.2));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.28), std(0x222222, 0.4, 0.8));
      barrel.position.set(0, 0.025, -0.36);
      const pump   = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.10), std(0x4a3a2a, 0.9, 0.1));
      pump.position.set(0, -0.005, -0.18);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.05), std(0x3a2a1a, 0.9, 0.1));
      grip.position.set(0, -0.09, 0.10);
      const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.18), std(0x3a2a1a, 0.8, 0.1));
      stock.position.set(0, 0.01, 0.30);
      g.add(body, barrel, pump, grip, stock);
    });

    // ── lmg (HAMMER) — thick, long, heavy ──
    addGroup('lmg', g => {
      const body   = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.52), std(0x1a1a1a));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.35), std(0x333333, 0.3, 0.9));
      barrel.position.set(0, 0.015, -0.43);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.08), std(0x2a2a2a));
      handle.position.set(0, 0.06, -0.05);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.05), std(0x1a1208, 0.9, 0.1));
      grip.position.set(0, -0.09, 0.12);
      const mag    = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.08), std(0x2a2a2a));
      mag.position.set(0, -0.05, -0.06);
      const bipod1 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.06, 0.005), std(0x333333));
      bipod1.position.set(-0.03, -0.06, -0.40);
      const bipod2 = bipod1.clone();
      bipod2.position.set(0.03, -0.06, -0.40);
      g.add(body, barrel, handle, grip, mag, bipod1, bipod2);
    });

    // ── dmr (VANTAGE) — medium-length, scope, semi ──
    addGroup('dmr', g => {
      const body   = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.45), std(0x1a1a2a));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.20), std(0x333355, 0.3, 0.9));
      barrel.position.set(0, 0.012, -0.32);
      const scope  = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), std(0x111122, 0.3, 0.9));
      scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.048, 0.00);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.048), std(0x1a1a2a, 0.9, 0.1));
      grip.position.set(0, -0.085, 0.12);
      const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.055, 0.14), std(0x1a1a2a));
      stock.position.set(0, 0.003, 0.28);
      g.add(body, barrel, scope, grip, stock);
    });

    // ── burst (PULSE) — compact, futuristic ──
    addGroup('burst', g => {
      const body   = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.07, 0.36), std(0x0a1a2a));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.14), std(0x0055aa, 0.3, 0.9));
      barrel.position.set(0, 0.012, -0.25);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.046), std(0x0a1a2a, 0.9, 0.2));
      grip.position.set(0, -0.082, 0.09);
      const mag    = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.075, 0.048), std(0x0a2a3a));
      mag.position.set(0, -0.04, -0.02);
      // LED strip
      const led    = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.005, 0.20), std(0x0088ff, 0.1, 0.2));
      led.position.set(0, 0.038, -0.06);
      g.add(body, barrel, grip, mag, led);
    });

    // ── rail (RAIL GUN) — sleek, glowing ──
    addGroup('rail', g => {
      const body   = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.065, 0.55), std(0x111122));
      // Rail coils
      for (let i = 0; i < 6; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12), std(0x4466ff, 0.2, 1.0));
        coil.rotation.x = Math.PI / 2;
        coil.position.set(0, 0.01, -0.30 + i * 0.06);
        g.add(coil);
      }
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.30), std(0x2233aa, 0.2, 1.0));
      barrel.position.set(0, 0.01, -0.42);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.10, 0.046), std(0x111122, 0.9, 0.2));
      grip.position.set(0, -0.082, 0.14);
      g.add(body, barrel, grip);
    });

    // ── carbine ──
    addGroup('carbine', g => {
      const body   = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.40), std(0x2a2a2a));
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.16), std(0x444444, 0.3, 0.9));
      barrel.position.set(0, 0.012, -0.28);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.105, 0.048), std(0x1a120a, 0.9, 0.1));
      grip.position.set(0, -0.085, 0.10);
      const mag    = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.075, 0.048), std(0x333333));
      mag.position.set(0, -0.04, -0.02);
      const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.052, 0.12), std(0x2a2a2a));
      stock.position.set(0, 0.002, 0.25);
      g.add(body, barrel, grip, mag, stock);
    });

    // ── rpg ──
    addGroup('rpg', g => {
      // 발사관 (긴 원통)
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.70, 8),
        std(0x4a3a28, 0.7, 0.3)
      );
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, -0.01, -0.25);
      // 탄두 (앞 원뿔)
      const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.044, 0.22, 8),
        std(0x333333, 0.3, 0.8)
      );
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, -0.01, -0.67);
      // 손잡이
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.042, 0.13, 0.052),
        std(0x2a1a0a, 0.9, 0.1)
      );
      grip.position.set(0, -0.11, -0.10);
      // 후방 플레어 (원통)
      const rear = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.065, 0.12, 8),
        std(0x555555, 0.4, 0.6)
      );
      rear.rotation.x = Math.PI / 2;
      rear.position.set(0, -0.01, 0.21);
      // 조준기
      const sight = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.06, 0.012),
        std(0x111111, 0.5, 0.5)
      );
      sight.position.set(0, 0.07, -0.15);
      // 글로우 (분사구)
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.0 })
      );
      glow.position.set(0, -0.01, 0.30);
      g.add(tube, nose, grip, rear, sight, glow);
      g._glow = glow;  // 발사 시 글로우 효과용
    });

    // ── grenade ──
    this._fpGrenadeGroup = new THREE.Group();
    this._fpGrenadeGroup.visible = false;
    const gMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x2d4a1e, roughness: 0.8, metalness: 0.2 }));
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 6),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, metalness: 0.9 }));
    pin.position.set(0.04, 0.07, 0); pin.rotation.z = Math.PI / 4;
    this._fpGrenadeGroup.add(gMesh, pin);
    wCam.add(this._fpGrenadeGroup);

    // Legacy aliases (used elsewhere)
    this._fpSniperGroup = this._fpGroups['sniper'];
    this._fpPistolGroup = this._fpGroups['pistol'];

    this._loadGun(renderer);
    this.grenadeSystem = new GrenadeSystem(renderer.scene, boxes);
  }

  // ─────────────────────────────────────────
  // OBJ load
  // ─────────────────────────────────────────
  _loadGun(renderer) {
    const loader = new OBJLoader();
    // MeshStandardMaterial gives proper light/shadow (PBR)
    const gunMat = new THREE.MeshStandardMaterial({
      color:     0x2a2a2a,
      roughness: 0.55,
      metalness: 0.80,
      map: renderer.getTexWeapon?.() || null,
    });

    loader.load(
      './m4a1.obj',
      (obj) => {
        // Apply PBR material + shadow to every mesh
        obj.traverse(child => {
          if (child.isMesh) {
            child.material   = gunMat.clone();
            child.castShadow = true;
            child.receiveShadow = false;
          }
        });

        // ── Measure OBJ size then normalize ──
        const box3 = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box3.getSize(size);
        const center = new THREE.Vector3();
        box3.getCenter(center);
        const maxDim = Math.max(size.x, size.y, size.z);

        // OBJ analysis: barrel runs along +Z (z: 1.45~36.77), Y center=9.56
        // After rotation Y=PI: +Z becomes -Z (camera forward = correct)
        // We offset so: muzzle tip sits near z=-0.3 in front of camera,
        // grip at right-bottom of screen.

        // ── 1P gun ──
        const scale = 0.55 / maxDim;
        const gun1P = obj.clone(true);
        gun1P.scale.setScalar(scale);
        // Shift so breech end (z=1.45 * scale after rot = front of view) is at z≈0
        // After Y=PI rot, OBJ +Z → camera -Z:
        //   OBJ z=1.45 (breech) → camera z = -1.45*scale ≈ -0.022  (near camera)
        //   OBJ z=36.77 (muzzle) → camera z = -36.77*scale ≈ -0.555 (deep into scene)
        // OBJ bounds: X≈-1.47~+1.46, Y≈4.01~15.1, Z≈1.45~36.77
        // After rotation Y=PI: OBJ +Z → camera -Z (forward)
        // We want: gun centered on X, grip-area at group origin, muzzle pointing -Z
        //
        // In OBJ space (before rotation):
        //   breech = z_min = 1.45  → after rot becomes camera +Z (behind)  bad
        //   muzzle = z_max = 36.77 → after rot becomes camera -Z (forward) good
        //
        // After Y=PI rotation the child's local axes flip:
        //   child.x = -OBJ.x,  child.z = -OBJ.z
        // So to center the gun on X:  offset.x = +center.x * scale
        // To put breech at group origin (z=0): offset.z = +center.z * scale
        //   (pulls the whole gun so its center is at z=0; muzzle goes to -halfZ)
        // Y: shift down so grip (min.y) is near y=0
        //   offset.y = -box3.min.y * scale  → grip sits at y=0

        // Keep gun1P centered on X only. Y/Z offsets removed so that
        // _fpWeaponGroup.position directly maps to screen coords (no surprise shifts at ADS).
        gun1P.position.set(
          center.x * scale,  // X mirror-correct after Y=PI group rotation
          0,                 // Y: no internal offset — group Y controls height
          0                  // Z: no internal offset — group Z controls depth
        );
        gun1P.rotation.set(0, 0, 0);
        this._fpWeaponGroup.rotation.set(0, Math.PI, 0);
        this._fpWeaponGroup.add(gun1P);
        this._gunMesh1P = gun1P;

        // ── 3P gun ──
        const scale3P = 0.45 / maxDim;
        const gun3P = obj.clone(true);
        gun3P.scale.setScalar(scale3P);
        gun3P.position.set(-center.x * scale3P, -center.y * scale3P, -center.z * scale3P);
        gun3P.rotation.set(0, Math.PI, 0);
        this._gunGroup3P.add(gun3P);
        this._gunMesh3P = gun3P;

        this._gunLoaded = true;
        console.log('[OK] m4a1.obj loaded, scale=', scale.toFixed(4));
      },
      (xhr) => {
        if (xhr.total) console.log(`[🔃] m4a1.obj ${(xhr.loaded/xhr.total*100).toFixed(0)}%`);
      },
      (err) => {
        console.warn('[WARN] m4a1.obj load failed, using box fallback:', err);
        // Fallback: replace with box
        this._buildFallbackGun(renderer);
      }
    );
  }

  // Box fallback gun when OBJ load fails
  _buildFallbackGun(renderer) {
    const gMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.8, map: renderer.getTexWeapon?.() || null });
    const g1 = new THREE.Group();
    g1.add(new THREE.Mesh(new THREE.BoxGeometry(0.06,0.08,0.5),  gMat));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.12,0.06), gMat);
    grip.position.set(0,-0.08,0.08); g1.add(grip);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.03,0.15), gMat);
    barrel.position.set(0,0.01,-0.32); g1.add(barrel);
    this._fpWeaponGroup.add(g1);
    this._gunMesh1P = g1;

    const g3 = g1.clone(true);
    this._gunGroup3P.add(g3);
    this._gunMesh3P = g3;
    this._gunLoaded = true;
  }

  // ─────────────────────────────────────────
  // Local 3P body
  // ─────────────────────────────────────────
  _buildLocalBody(renderer) {
    const scene = renderer.scene;
    const pMat  = (col) => new THREE.MeshLambertMaterial({ color: col, map: renderer.getTexPlayer() });
    const box   = (sx,sy,sz) => new THREE.BoxGeometry(sx*2, sy*2, sz*2);

    this.bodyGroup = new THREE.Group();
    this.bodyGroup.visible = false;

    // Torso
    const body = new THREE.Mesh(box(0.4,0.6,0.25), pMat(0x3366aa));
    body.position.y = 1.0; body.castShadow = true;
    this.bodyGroup.add(body);

    // Head pivot
    this._headPivot = new THREE.Group();
    this._headPivot.position.y = 1.7;
    const head = new THREE.Mesh(box(0.25,0.25,0.25), pMat(0x4477bb));
    head.castShadow = true; this._headPivot.add(head);
    this.bodyGroup.add(this._headPivot);

    // Left leg
    this._legLPivot = new THREE.Group();
    this._legLPivot.position.set(-0.25, 1.0, 0);
    const legL = new THREE.Mesh(box(0.2,0.7,0.2), pMat(0x2255aa));
    legL.position.y = -0.7; legL.castShadow = true; this._legLPivot.add(legL);
    this.bodyGroup.add(this._legLPivot);

    // Right leg
    this._legRPivot = new THREE.Group();
    this._legRPivot.position.set(0.25, 1.0, 0);
    const legR = new THREE.Mesh(box(0.2,0.7,0.2), pMat(0x2255aa));
    legR.position.y = -0.7; legR.castShadow = true; this._legRPivot.add(legR);
    this.bodyGroup.add(this._legRPivot);

    // Right arm
    this._armRPivot = new THREE.Group();
    this._armRPivot.position.set(0.45, 1.4, 0.05);
    const armR = new THREE.Mesh(box(0.15,0.6,0.15), pMat(0x3366aa));
    armR.position.y = -0.6; armR.castShadow = true; this._armRPivot.add(armR);
    this.bodyGroup.add(this._armRPivot);

    // Left arm
    this._armLPivot = new THREE.Group();
    this._armLPivot.position.set(-0.45, 1.4, 0.05);
    const armL = new THREE.Mesh(box(0.15,0.7,0.15), pMat(0x3366aa));
    armL.position.y = -0.7; armL.castShadow = true; this._armLPivot.add(armL);
    this.bodyGroup.add(this._armLPivot);

    // Gun group — bodyGroup 직접 자식, 중심점은 총 중앙
    // 총 위치: 오른쪽 앞, 몸통 완전히 밖 (z=-0.55: 몸 앞, x=0.3: 오른쪽)
    this._gunGroup3P = new THREE.Group();
    this._gunGroup3P.position.set(0.3, 1.15, -0.55);
    this.bodyGroup.add(this._gunGroup3P);

    // List of meshes to apply pixel texture
    this._bodyMeshes = [body, head, legL, legR, armR, armL];

    scene.add(this.bodyGroup);
  }

  // ── Apply local pixels as solid average color per body part ──
  // BoxGeometry UV is 0~1 per face, so 16x16 DataTexture
  // stretches and appears black. Set average color to material.color directly.
  applyPixels(pixels) {
    if (!pixels || !this._bodyMeshes) return;

    const avg = (x0, x1, y0, y1) => {
      let r=0, g=0, b=0, n=0;
      for (let y=y0; y<=y1; y++) {
        for (let x=x0; x<=x1; x++) {
          const col = pixels[y]?.[x];
          if (col && col !== 'null' && typeof col === 'string' && col.startsWith('#') && col.length === 7) {
            r += parseInt(col.slice(1,3), 16);
            g += parseInt(col.slice(3,5), 16);
            b += parseInt(col.slice(5,7), 16);
            n++;
          }
        }
      }
      if (n === 0) return new THREE.Color(0x556688); // default color
      return new THREE.Color(r/n/255, g/n/255, b/n/255);
    };

    const [body, head, legL, legR, armR, armL] = this._bodyMeshes;
    const setColor = (mesh, color) => {
      mesh.material.map   = null;   // remove texture (causes black)
      mesh.material.color.copy(color);
      mesh.material.needsUpdate = true;
    };

    setColor(head, avg(4, 11,  0,  4));   // head
    setColor(body, avg(3, 12,  5, 10));   // Torso
    setColor(legL, avg(4,  7, 11, 15));   // Left leg
    setColor(legR, avg(8, 11, 11, 15));   // Right leg
    setColor(armR, avg(13,15,  5,  9));   // Right arm
    setColor(armL, avg(0,  2,  5,  9));   // Left arm
  }

  // ─────────────────────────────────────────
  // Input
  // ─────────────────────────────────────────
  _bindInput() {
    window.addEventListener('keydown', e => { this.keys[e.code] = true; });
    window.addEventListener('keyup',   e => { this.keys[e.code] = false; });
    window.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouse.left  = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) { this.mouse.left = false; this.mouseLeftHeld = false; }
      if (e.button === 2) this.mouse.right = false;
    });
  }

  // ─────────────────────────────────────────
  // Collision
  // ─────────────────────────────────────────
  checkCollision(pos) {
    const feetY = pos.y, headY = pos.y + this.playerHeight;
    for (const b of this.boxes) {
      const [bx,by,bz] = b.pos, [sx,sy,sz] = b.size;
      if (pos.x > bx-sx-this.playerRadius && pos.x < bx+sx+this.playerRadius &&
          feetY < by+sy && headY > by-sy &&
          pos.z > bz-sz-this.playerRadius && pos.z < bz+sz+this.playerRadius)
        return true;
    }
    return false;
  }

  setLoadout(ids) {
    this.loadoutIds = normalizeLoadout(ids);
    localStorage.setItem('vp_loadout', JSON.stringify(this.loadoutIds));
    if (this.onHudUpdate) this.onHudUpdate();
  }

  getLoadoutWeapon(slot = this.weaponSlot) {
    const idx = slot === 2 ? 1 : slot === 5 ? 2 : 0;
    return getWeaponById(this.loadoutIds[idx]);
  }

  getLoadoutState(slot = this.weaponSlot) {
    const weapon = this.getLoadoutWeapon(slot);
    return this.weaponStates[weapon.id];
  }

  // ─────────────────────────────────────────
  // Shooting
  // ─────────────────────────────────────────
  shoot(checkHitFn) {
    this._syncWeaponStats();
    if (this.ammo <= 0 || this.isReloading) return;
    const profile = this.getWeaponProfile();
    this.ammo--;
    this._writeWeaponAmmo();
    this.recoilOffset = profile.recoil;
    this.recoilRoll   = (Math.random() * 6 - 3) * (profile.name === 'SNIPER' ? 1.8 : 1);
    if (checkHitFn)       checkHitFn();
    if (this.onShoot)     this.onShoot();
    if (this.onHudUpdate) this.onHudUpdate();
  }

  shootLoadoutWeapon(checkHitFn) {
    const weapon = this.getLoadoutWeapon();
    const state = this.weaponStates[weapon.id];
    if (!state || state.ammo <= 0 || state.reloading || state.cooldown > 0) return;
    const shouldFire = weapon.auto ? this.mouse.left : !this.mouseLeftHeld;
    if (!shouldFire) return;

    // RPG: 로켓 발사체 처리
    if (weapon.isProjectile) {
      if (this._camCtrlRef) this._fireRocket(this._camCtrlRef);
      state.ammo--;
      state.cooldown = weapon.fireRate;
      this.recoilOffset = weapon.recoil;
      if (this.onHudUpdate) this.onHudUpdate();
      if (!weapon.auto) this.mouseLeftHeld = true;
      if (state.ammo === 0 && state.reserve > 0) this.startReload();
      return;
    }

    state.ammo--;
    state.cooldown = weapon.fireRate;
    this.recoilOffset = weapon.recoil;
    this.recoilRoll = (Math.random() * 6 - 3) * (weapon.scope ? 1.8 : 1);
    this.recoilYaw += (Math.random() - 0.5) * weapon.recoil * 0.75;
    this.recoilPitch += weapon.recoil * 0.55;
    if (checkHitFn) checkHitFn(weapon.id);
    if (this.onShoot) this.onShoot(weapon);
    if (this.onHudUpdate) this.onHudUpdate();
    if (!weapon.auto) this.mouseLeftHeld = true;
    if (state.ammo === 0 && state.reserve > 0) this.startReload();
  }

  // Refill from supply crate
  refillFromCrate() {
    this.ammo         = this.maxAmmo;
    this.totalAmmo    = this.maxTotalAmmo;
    this.sniperAmmo   = this.sniperMaxAmmo;
    this.sniperTotalAmmo = this.sniperMaxTotal;
    this.pistolAmmo   = this.pistolMaxAmmo;
    this.pistolTotalAmmo = this.pistolMaxTotal;
    this.weaponAmmo.rifle.ammo     = this.weaponProfiles.rifle.maxAmmo;
    this.weaponAmmo.rifle.reserve  = this.weaponProfiles.rifle.maxReserve;
    this.weaponAmmo.sniper.ammo    = this.weaponProfiles.sniper.maxAmmo;
    this.weaponAmmo.sniper.reserve = this.weaponProfiles.sniper.maxReserve;
    for (const weapon of this.weaponCatalog) {
      const state = this.weaponStates[weapon.id];
      state.ammo = weapon.maxAmmo;
      state.reserve = weapon.reserve;
      state.reloading = false;
      state.reloadTimer = 0;
    }
    this._syncWeaponStats();
    this.grenadeCount = this.maxGrenades;
    this.bandageCount = this.maxBandage;
    this.isReloading  = false;
    this.sniperReloading = false;
    this.pistolReloading = false;
    if (this.onHudUpdate) this.onHudUpdate();
  }

  startReload() {
    // Reload allowed during jump/movement (canUseBaseAction is bandage-only)
    if (this.weaponSlot === 1 || this.weaponSlot === 2 || this.weaponSlot === 5) {
      const weapon = this.getLoadoutWeapon();
      const state = this.weaponStates[weapon.id];
      if (state.ammo < weapon.maxAmmo && !state.reloading && state.reserve > 0) {
        state.reloading = true;
        state.reloadTimer = weapon.reload;
        if (this.onHudUpdate) this.onHudUpdate();
      }
      return;
    }
    if (this.weaponSlot === 1 && this.ammo < this.maxAmmo && !this.isReloading && this.totalAmmo > 0) {
      this.isReloading = true;
      this.reloadTimer = this.reloadDuration;
      if (this.onHudUpdate) this.onHudUpdate();
    } else if (this.weaponSlot === 2 && this.sniperAmmo < this.sniperMaxAmmo && !this.sniperReloading && this.sniperTotalAmmo > 0) {
      this.sniperReloading = true;
      this.sniperReloadTimer = this.sniperReloadDur;
      if (this.onHudUpdate) this.onHudUpdate();
    } else if (this.weaponSlot === 5 && this.pistolAmmo < this.pistolMaxAmmo && !this.pistolReloading && this.pistolTotalAmmo > 0) {
      this.pistolReloading = true;
      this.pistolReloadTimer = this.pistolReloadDur;
      if (this.onHudUpdate) this.onHudUpdate();
    }
  }

  // ─────────────────────────────────────────
  // Main update
  // ─────────────────────────────────────────
  update(camCtrl, checkHitFn, dt = 1/60) {
    // Scale normalised to 60fps (FPS-independent physics)
    const scale = dt * 60;
    const keys = this.keys, mouse = this.mouse;
    this._camCtrlRef = camCtrl; // RPG 발사용 카메라 참조 저장

    // ADS
    this.isAiming    = mouse.right && !this.isReloading;
    this.adsProgress += (this.isAiming ? 1 : -1) * 0.1 * scale;
    this.adsProgress  = Math.max(0, Math.min(1, this.adsProgress));

    // Recoil damping
    this.recoilOffset = Math.max(0, this.recoilOffset - 0.05 * scale);
    if (camCtrl) {
      camCtrl.yaw += this.recoilYaw;
      camCtrl.pitch = Math.max(-89, Math.min(89, camCtrl.pitch + this.recoilPitch));
      this.recoilYaw   *= Math.pow(0.58, scale);
      this.recoilPitch *= Math.pow(0.52, scale);
    }

    // Movement direction
    const yawRad = THREE.MathUtils.degToRad(camCtrl.yaw);
    const front  = new THREE.Vector3(Math.cos(yawRad), 0, Math.sin(yawRad));
    const right  = new THREE.Vector3(-Math.sin(yawRad), 0, Math.cos(yawRad));
    const moveDir = new THREE.Vector3();
    let targetTilt = 0;

    if (keys['KeyW']) moveDir.addScaledVector(front,  1);
    if (keys['KeyS']) moveDir.addScaledVector(front, -1);
    if (keys['KeyA']) { moveDir.addScaledVector(right, -1); targetTilt -= 3; }
    if (keys['KeyD']) { moveDir.addScaledVector(right,  1); targetTilt += 3; }

    // Weapon slot switch
    if (keys['Digit1'] && !this._slot1Held && !this.isReloading) { this.weaponSlot = 1; this._slot1Held = true; if (this.onHudUpdate) this.onHudUpdate(); }
    if (!keys['Digit1']) this._slot1Held = false;
    const canSwitchWeapon = !this.isReloading && !this.sniperReloading && !this.pistolReloading &&
      !Object.values(this.weaponStates).some(s => s.reloading);
    if (keys['Digit2'] && !this._slot2Held && canSwitchWeapon) { this.weaponSlot = 2; this._slot2Held = true; if (this.onHudUpdate) this.onHudUpdate(); }
    if (!keys['Digit2']) this._slot2Held = false;
    if (keys['Digit5'] && !this._slot5Held && canSwitchWeapon) { this.weaponSlot = 5; this._slot5Held = true; if (this.onHudUpdate) this.onHudUpdate(); }
    if (!keys['Digit5']) this._slot5Held = false;
    if (keys['Digit4'] && !this._slot4Held && this.grenadeCount > 0 && canSwitchWeapon) { this.weaponSlot = 4; this._slot4Held = true; if (this.onHudUpdate) this.onHudUpdate(); }
    if (!keys['Digit4']) this._slot4Held = false;
    if (keys['Digit3'] && !this._slot3Held && this.bandageCount > 0 && !this.isReloading) { this.weaponSlot = 3; this._slot3Held = true; if (this.onHudUpdate) this.onHudUpdate(); }
    if (!keys['Digit3']) this._slot3Held = false;

    // M key fire mode (M4A1 only, sniper/pistol are SEMI fixed)
    if (this.weaponSlot === 1) {
      if (keys['KeyM']) {
        if (!this.mKeyHeld) {
          this.fireMode = this.fireMode === 'AUTO' ? 'SEMI' : 'AUTO';
          this.mKeyHeld = true;
          if (this.onHudUpdate) this.onHudUpdate();
        }
      } else { this.mKeyHeld = false; }
    }

    // ── Per-slot left-click action ──
    this.fireCooldown = Math.max(0, this.fireCooldown - scale);
    this.pistolFireCd = Math.max(0, this.pistolFireCd - scale);
    this.sniperFireCd = Math.max(0, this.sniperFireCd - scale);
    for (const state of Object.values(this.weaponStates)) {
      state.cooldown = Math.max(0, state.cooldown - scale);
    }

    // Auto switch to 1P view on sniper right-click
    const equipped = this.getLoadoutWeapon();
    if (equipped.scope && mouse.right && camCtrl && !camCtrl.isFirstPerson) {
      camCtrl.cameraDistance = 0;
      camCtrl.isFirstPerson  = true;
    }

    if (this.weaponSlot === 1 || this.weaponSlot === 2 || this.weaponSlot === 5) {
      this.isScopedIn = !!equipped.scope && mouse.right;
      this.scopeProgress += (this.isScopedIn ? 1 : -1) * 0.12;
      this.scopeProgress = Math.max(0, Math.min(1, this.scopeProgress));
      if (mouse.left) {
        this.shootLoadoutWeapon(checkHitFn);
      } else { this.mouseLeftHeld = false; }
      this.isChargingGrenade = false;
      this.grenadeCharge = 0;
      this.isBandaging = false;
    } else if (false && this.weaponSlot === 2) {
      // ── Sniper: SEMI, right-click scope ──
      this.isScopedIn = mouse.right && !this.sniperReloading;
      this.scopeProgress += (this.isScopedIn ? 1 : -1) * 0.12;
      this.scopeProgress = Math.max(0, Math.min(1, this.scopeProgress));

      if (mouse.left && !this.mouseLeftHeld) {
        if (!this.sniperReloading && this.sniperAmmo > 0 && this.sniperFireCd === 0) {
          this.sniperAmmo--;
          this.sniperFireCd = this.sniperFireRate;
          this.recoilOffset = 0.6;
          this.recoilRoll   = (Math.random() * 10 - 5);
          if (checkHitFn) checkHitFn('sniper');
          if (this.onShoot)     this.onShoot();
          if (this.onHudUpdate) this.onHudUpdate();
        }
        this.mouseLeftHeld = true;
      }
      if (!mouse.left) this.mouseLeftHeld = false;

      // Auto reload (when ammo hits 0)
      if (this.sniperAmmo === 0 && !this.sniperReloading && this.sniperTotalAmmo > 0) {
        this.sniperReloading = true;
        this.sniperReloadTimer = this.sniperReloadDur;
        if (this.onHudUpdate) this.onHudUpdate();
      }
      this.isChargingGrenade = false;
      this.grenadeCharge = 0;
      this.isBandaging = false;

    } else if (false && this.weaponSlot === 5) {
      // ── Pistol: SEMI ──
      this.isScopedIn = false; this.scopeProgress = 0;
      if (mouse.left && !this.mouseLeftHeld) {
        if (!this.pistolReloading && this.pistolAmmo > 0 && this.pistolFireCd === 0) {
          this.pistolAmmo--;
          this.recoilOffset = 0.2;
          this.recoilRoll   = (Math.random() * 4 - 2);
          if (checkHitFn) checkHitFn('pistol');
          if (this.onShoot)     this.onShoot();
          if (this.onHudUpdate) this.onHudUpdate();
          this.pistolFireCd = this.pistolFireRate;
        }
        this.mouseLeftHeld = true;
      }
      if (!mouse.left) this.mouseLeftHeld = false;

      // Auto reload
      if (this.pistolAmmo === 0 && !this.pistolReloading && this.pistolTotalAmmo > 0) {
        this.pistolReloading = true;
        this.pistolReloadTimer = this.pistolReloadDur;
        if (this.onHudUpdate) this.onHudUpdate();
      }
      this.isChargingGrenade = false;
      this.grenadeCharge = 0;
      this.isBandaging = false;

    } else if (this.weaponSlot === 4) {
      // Grenade: hold left-click to charge, release to throw
      if (mouse.left && this.grenadeCount > 0) {
        this.isChargingGrenade = true;
        this.grenadeCharge = Math.min(this.grenadeCharge + scale, this.grenadeMaxCharge);
      } else if (!mouse.left && this.isChargingGrenade) {
        // Mouse released → throw
        const power = this.grenadeCharge / this.grenadeMaxCharge;
        if (this.grenadeSystem) {
          const yawRad = THREE.MathUtils.degToRad(camCtrl.yaw);
          const throwFront = new THREE.Vector3(Math.cos(yawRad), 0, Math.sin(yawRad));
          this.grenadeSystem.throw(this.pos.clone(), throwFront, camCtrl.pitch, power);
          this.grenadeCount--;
          if (this.grenadeCount === 0) this.weaponSlot = 1; // switch to gun when empty
        }
        this.grenadeCharge = 0;
        this.isChargingGrenade = false;
        if (this.onHudUpdate) this.onHudUpdate();
      }
      this.isBandaging = false;

    } else if (this.weaponSlot === 3) {
      // Bandage: hold left-click 1.5s → heal 30 HP
      if (mouse.left && this.bandageCount > 0 && this.health < this.maxHealth && !this.isBandaging) {
        this.isBandaging  = true;
        this.bandageTimer = this.bandageDuration;
      }
      this.isChargingGrenade = false;
      this.grenadeCharge = 0;
    }

    // Roll
    this.targetRoll   = targetTilt;
    this.currentRoll += (this.targetRoll + this.recoilRoll - this.currentRoll) * 0.15 * scale;
    this.recoilRoll  *= Math.pow(0.8, scale);

    const isMoving = moveDir.length() > 0;
    if (isMoving) moveDir.normalize();

    // Walking bob
    if (isMoving && !this.isJumping && !this.isSliding) {
      this.moveTime += this.baseSpeed * 1.4 * scale;
      this.bobAmp   += (1 - this.bobAmp) * 0.1 * scale;
    } else {
      this.bobAmp += (0 - this.bobAmp) * 0.1 * scale;
    }

    // Dash cooldown
    if (this.dashCooldown > 0) {
      this.dashCooldown -= scale;
      if (this.dashCooldown < 0) this.dashCooldown = 0;
      if (this.onHudUpdate) this.onHudUpdate();
    }

    // Slide start
    if (keys['ShiftLeft'] && !this.isSliding && !this.isJumping && isMoving && this.dashCooldown <= 0) {
      this.isSliding  = true;
      this.slideSpeed = this.baseSpeed * 6.8;
      this.slideDir.copy(moveDir);
      this.dashCooldown = this.dashCooldownMax;
      if (this.onHudUpdate) this.onHudUpdate();
    }

    // Jump (possible during slide → cancel slide then jump)
    const spacePressed = keys['Space'] && !this._spaceHeld;
    if (keys['Space'] && !this.isJumping) {
      this.isSliding = false;   // Immediately cancel slide
      this.yVel      = this.jumpStr;
      this.isJumping = true;
    }
    this._spaceHeld = !!keys['Space'];

    let actualMove = new THREE.Vector3();
    if (this.isSliding) {
      actualMove.copy(this.slideDir).multiplyScalar(this.slideSpeed * scale);
      this.slideSpeed -= 0.045 * scale;   // dt-based deceleration
      if (this.slideSpeed <= this.baseSpeed) this.isSliding = false;
    } else {
      if (isMoving) actualMove.copy(moveDir).multiplyScalar((this.baseSpeed + this.speedBoost) * scale);
    }

    // Collision movement
    if (actualMove.length() > 0) {
      const tryX = this.pos.clone(); tryX.x += actualMove.x;
      if (!this.checkCollision(tryX)) this.pos.x = tryX.x;
      const tryZ = this.pos.clone(); tryZ.z += actualMove.z;
      if (!this.checkCollision(tryZ)) this.pos.z = tryZ.z;
    }

    // Knockback velocity (from explosions) — decays over time
    if (this.knockbackVel && this.knockbackVel.lengthSq() > 0.0001) {
      const kbX = this.pos.clone(); kbX.x += this.knockbackVel.x * scale;
      if (!this.checkCollision(kbX)) this.pos.x = kbX.x; else this.knockbackVel.x = 0;
      const kbZ = this.pos.clone(); kbZ.z += this.knockbackVel.z * scale;
      if (!this.checkCollision(kbZ)) this.pos.z = kbZ.z; else this.knockbackVel.z = 0;
      // 감쇠
      this.knockbackVel.multiplyScalar(Math.pow(0.80, scale));
      if (this.knockbackVel.lengthSq() < 0.0001) this.knockbackVel.set(0,0,0);
    }

    // Gravity
    this.yVel += this.gravity * scale;
    if (this.speedBoost > 0) this.speedBoost *= Math.pow(0.94, scale);
    this.padCooldown = Math.max(0, this.padCooldown - scale);
    const tryY = this.pos.clone(); tryY.y += this.yVel * scale;
    if (!this.checkCollision(tryY)) {
      this.pos.y = tryY.y;
    } else {
      if (this.yVel < 0) this.isJumping = false;
      this.yVel = 0;
    }

    this._handleMapBoosters(spacePressed, moveDir);

    // Reload
    if (this.isReloading) {
      this.reloadTimer -= scale;
      if (this.reloadTimer <= 0) {
        this.isReloading = false;
        const needed = this.maxAmmo - this.ammo;
        const fill   = Math.min(needed, this.totalAmmo);
        this.ammo      += fill;
        this.totalAmmo -= fill;
        this._writeWeaponAmmo();
        if (this.onHudUpdate) this.onHudUpdate();
      }
    }

    // Sniper reload
    if (this.sniperReloading) {
      this.sniperReloadTimer -= scale;
      if (this.sniperReloadTimer <= 0) {
        this.sniperReloading = false;
        const needed = this.sniperMaxAmmo - this.sniperAmmo;
        const fill   = Math.min(needed, this.sniperTotalAmmo);
        this.sniperAmmo      += fill;
        this.sniperTotalAmmo -= fill;
        if (this.onHudUpdate) this.onHudUpdate();
      }
    }

    // Pistol reload
    if (this.pistolReloading) {
      this.pistolReloadTimer -= scale;
      if (this.pistolReloadTimer <= 0) {
        this.pistolReloading = false;
        const needed = this.pistolMaxAmmo - this.pistolAmmo;
        const fill   = Math.min(needed, this.pistolTotalAmmo);
        this.pistolAmmo      += fill;
        this.pistolTotalAmmo -= fill;
        if (this.onHudUpdate) this.onHudUpdate();
      }
    }

    // RPG 재장전
    if (this.rpgReloading) {
      this.rpgReloadTimer -= scale;
      if (this.rpgReloadTimer <= 0) {
        this.rpgReloading = false;
        const fill = Math.min(this.maxRpgCount - this.rpgCount, this.rpgReserve);
        this.rpgCount   += fill;
        this.rpgReserve -= fill;
        if (this.onHudUpdate) this.onHudUpdate();
      }
    }

    // RPG 로켓 물리 업데이트
    this._updateRockets(dt);

    for (const [weaponId, state] of Object.entries(this.weaponStates)) {
      if (!state.reloading) continue;
      const weapon = getWeaponById(weaponId);
      state.reloadTimer -= scale;
      if (state.reloadTimer <= 0) {
        state.reloading = false;
        const needed = weapon.maxAmmo - state.ammo;
        const fill = Math.min(needed, state.reserve);
        state.ammo += fill;
        state.reserve -= fill;
        if (this.onHudUpdate) this.onHudUpdate();
      }
    }

    // Bandage use timer
    if (this.isBandaging) {
      this.bandageTimer -= scale;
      if (this.bandageTimer <= 0) {
        this.isBandaging  = false;
        this.health       = Math.min(this.maxHealth, this.health + 30);
        this.bandageCount = Math.max(0, this.bandageCount - 1);
        if (this.bandageCount === 0) this.weaponSlot = 1;
        if (this.onHudUpdate) this.onHudUpdate();
        if (this.onBandageUsed) this.onBandageUsed();
      }
      // Cancel if mouse released or moving
      if (!this.mouse.left) {
        this.isBandaging = false;
        this.bandageTimer = 0;
      }
    }

    // Death/fall
    if (this.health <= 0 || this.pos.y <= -20) {
      this.weaponAmmo.rifle.ammo     = this.weaponProfiles.rifle.maxAmmo;
      this.weaponAmmo.rifle.reserve  = this.weaponProfiles.rifle.maxReserve;
      this.weaponAmmo.sniper.ammo    = this.weaponProfiles.sniper.maxAmmo;
      this.weaponAmmo.sniper.reserve = this.weaponProfiles.sniper.maxReserve;
      for (const weapon of this.weaponCatalog) {
        this.weaponStates[weapon.id].ammo = weapon.maxAmmo;
        this.weaponStates[weapon.id].reserve = weapon.reserve;
        this.weaponStates[weapon.id].reloading = false;
      }
      this._syncWeaponStats();
      this.grenadeCount = this.maxGrenades;
      this.rpgCount     = this.maxRpgCount;
      this.rpgReserve   = 12;
      this.rpgReloading = false;
      this._rockets     = [];
      this.bandageCount = 0;          // Bandage lost on death
      this.isBandaging  = false;
      this.isSliding    = false;
      this.yVel         = 0;
      this.pos.set(0, 1, 5);
      if (this.onDie) this.onDie();
      this.health = this.maxHealth;
      if (this.onHudUpdate) this.onHudUpdate();
    }

    this._updateLocalBody(camCtrl);
    this._updateFirstPersonWeapon(camCtrl);
    if (this.grenadeSystem) this.grenadeSystem.update(dt);
  }

  _handleMapBoosters(spacePressed, moveDir) {
    if (!this.renderer) return;
    const pad = this.renderer.getJumpPadAt?.(this.pos);
    if (pad && this.yVel <= 0.08 && this.padCooldown === 0) {
      this.yVel = Math.max(this.yVel, pad.power);
      this.isJumping = true;
      this.speedBoost = Math.max(this.speedBoost, pad.speed || 0);
      this.renderer.spawnPadBurst?.(this.pos, pad.color);
      this.padCooldown = 20;
    }

    const point = this.renderer.getAirPointAt?.(this.pos);
    if (!point) return;
    if (point.type === 'drop') {
      this.yVel = Math.min(this.yVel, -0.72);
      if (this.padCooldown === 0) {
        this.renderer.spawnPadBurst?.(this.pos, point.color);
        this.padCooldown = 12;
      }
      return;
    }
    if (spacePressed && this.padCooldown === 0) {
      this.yVel = Math.max(this.yVel, point.power);
      this.speedBoost = Math.max(this.speedBoost, point.speed || 0.015);
      this.isJumping = true;
      this.renderer.spawnPadBurst?.(this.pos, point.color);
      this.padCooldown = 18;
    }
  }

  // ─────────────────────────────────────────
  // 3P body update
  // ─────────────────────────────────────────
  _updateLocalBody(camCtrl) {
    const fp = camCtrl.isFirstPerson;
    this.bodyGroup.visible = !fp;
    if (fp) return;

    const slideOffset = this.isSliding ? -0.6 : 0;
    this.bodyGroup.position.set(this.pos.x, this.pos.y + 0.4 + slideOffset, this.pos.z);
    this.bodyGroup.rotation.y = -THREE.MathUtils.degToRad(camCtrl.yaw) - Math.PI / 2;

    // Head pitch — +pitch
    this._headPivot.rotation.x = THREE.MathUtils.degToRad(camCtrl.pitch);

    // Leg swing
    const swing = this.isSliding ? 0 : Math.sin(this.moveTime * 6) * (20 * Math.PI/180) * this.bobAmp;
    this._legLPivot.rotation.x = this.isSliding ?  (70*Math.PI/180) :  swing;
    this._legRPivot.rotation.x = this.isSliding ? -(70*Math.PI/180) : -swing;

    // Gun pitch — 총 중심점에서 회전 (+pitch)
    const ads = this.adsProgress;
    const pitchRad = THREE.MathUtils.degToRad(camCtrl.pitch);
    this._gunGroup3P.rotation.x = pitchRad - this.recoilOffset * 0.3;

    // ── 팔을 총 그립/포어그립에 정확히 붙이기 ──
    this._gunGroup3P.updateMatrixWorld(true);
    this.bodyGroup.updateMatrixWorld(true);

    const _gripLocal  = new THREE.Vector3(0, -0.10,  0.10);
    const _foregrip   = new THREE.Vector3(0, -0.05, -0.15);
    const gripWorld   = _gripLocal.clone().applyMatrix4(this._gunGroup3P.matrixWorld);
    const foregripW   = _foregrip.clone().applyMatrix4(this._gunGroup3P.matrixWorld);

    const armRWorld = new THREE.Vector3(0.45, 1.4, 0.05).applyMatrix4(this.bodyGroup.matrixWorld);
    const armLWorld = new THREE.Vector3(-0.45, 1.4, 0.05).applyMatrix4(this.bodyGroup.matrixWorld);

    const groupMatInv = new THREE.Matrix4().copy(this.bodyGroup.matrixWorld).invert();

    const aimArm = (pivot, gripW, pivotW) => {
      const gripLocal  = gripW.clone().applyMatrix4(groupMatInv);
      const pivotLocal = pivotW.clone().applyMatrix4(groupMatInv);
      const dir = new THREE.Vector3().subVectors(gripLocal, pivotLocal).normalize();
      pivot.rotation.x = Math.atan2(-dir.z, -dir.y);
      pivot.rotation.z = Math.atan2( dir.x, -dir.y);
    };

    aimArm(this._armRPivot, gripWorld,  armRWorld);
    aimArm(this._armLPivot, foregripW,  armLWorld);
  }

  // ─────────────────────────────────────────
  // 1P weapon update — all positions are in weaponCamera local space
  _updateFirstPersonWeapon(camCtrl) {
    const fp      = camCtrl.isFirstPerson;
    const slot    = this.weaponSlot;
    const weapon  = this.getLoadoutWeapon(slot);
    const wid     = weapon?.id || 'm4a1';
    const isScope = !!weapon?.scope;

    // ── Hide ALL groups first ──
    this._fpWeaponGroup.visible  = false;
    this._fpGrenadeGroup.visible = false;
    for (const g of Object.values(this._fpGroups || {})) g.visible = false;

    if (!fp) return;

    // ── Show only active weapon group ──
    if (slot === 4) {
      this._fpGrenadeGroup.visible = true;
    } else if (slot !== 3) {
      const grp = this._fpGroups?.[wid];
      if (grp) grp.visible = !(isScope && this.scopeProgress >= 0.85);
    }

    const ads       = this.adsProgress;
    const recoilZ   = this.recoilOffset;
    const recoilY   = this.recoilOffset * 0.08;
    const bobFactor = ads > 0.5 ? 0.15 : 1.0;
    const bobX = Math.cos(this.moveTime * 2.5) * 0.004 * this.bobAmp * bobFactor;
    const bobY = Math.sin(this.moveTime * 5)   * 0.004 * this.bobAmp * bobFactor;

    // ── Grenade ──
    if (slot === 4) {
      const charge = this.grenadeCharge / this.grenadeMaxCharge;
      this._fpGrenadeGroup.position.set(
        0.18 + charge * 0.04,
        -0.20 - charge * 0.08 + bobY,
        -0.40 + charge * 0.12
      );
      this._fpGrenadeGroup.rotation.set(
        Math.sin(this.moveTime * 7) * 0.02 * this.bobAmp, 0, charge * -0.15
      );
      return;
    }

    const grp = this._fpGroups?.[wid];
    if (!grp) return;

    // M4A1 uses OBJ model with Y=PI group rotation (world_z = grp_z - gun_z)
    // Box models are -Z forward natively
    const isOBJ = wid === 'm4a1';

    // HIP / ADS positions
    // OBJ (m4a1): muzzle at grp_z - 0.573 → grp_z=0.05 → muzzle=-0.52 ✓
    // Box models: directly in camera space
    const HIP_X = 0.22, HIP_Y = isOBJ ? -0.26 : -0.16, HIP_Z = isOBJ ? 0.05 : -0.65;
    const ADS_X = 0.00, ADS_Y = isOBJ ? -0.26 : -0.16, ADS_Z = isOBJ ? 0.15 : -0.50;

    // ── Scope weapons (sniper-class) ──
    if (isScope) {
      const sc = this.scopeProgress;
      grp.position.set(
        HIP_X + (0.0 - HIP_X) * sc + bobX * (1-sc),
        HIP_Y + (0.0 - HIP_Y) * sc + recoilY + bobY * (1-sc),
        HIP_Z + (-0.50 - HIP_Z) * sc + recoilZ
      );
      grp.rotation.set(0, 0, 0);
      return;
    }

    // ── Reload animation (weapon-specific) ──
    let reloadDX = 0, reloadDY = 0, reloadDZ = 0;
    let reloadRX = 0, reloadRZ = 0;
    const reloading = this.isReloading ||
      (slot === 2 && this.sniperReloading) ||
      (slot === 5 && this.pistolReloading) ||
      (this._fpGroups?.[wid] && this.weaponStates?.[wid]?.reloading);
    if (reloading) {
      const state = this.weaponStates?.[wid];
      const dur   = state?.reloadTimer !== undefined
        ? (this.getLoadoutWeapon()?.reload || 60)
        : (this.reloadDuration || 60);
      const timerVal = state?.reloadTimer !== undefined ? state.reloadTimer : (this.reloadTimer ?? 0);
      const prog = Math.max(0, Math.min(1, 1 - timerVal / dur));
      const wave = Math.sin(prog * Math.PI);

      if (wid === 'm4a1') {
        // M4A1: mag drop down then snap back
        reloadDY  = -wave * 0.13;
        reloadDZ  =  wave * 0.04;
        reloadRX  =  wave * 22;
        reloadRZ  =  wave * 8;
      } else if (wid === 'sniper') {
        // Sniper: big tilt to the side (bolt action feel)
        reloadDY  = -wave * 0.10;
        reloadRX  =  wave * 18;
        reloadRZ  = -wave * 15;  // tilt left
      } else if (wid === 'pistol') {
        // Pistol: quick dip
        reloadDY  = -wave * 0.09;
        reloadRX  =  wave * 15;
        reloadRZ  =  wave * 5;
      } else if (wid === 'smg') {
        // SMG: fast mag swap, slight rotate
        reloadDY  = -wave * 0.08;
        reloadRX  =  wave * 16;
        reloadRZ  =  wave * 6;
      } else if (wid === 'shotgun') {
        // Shotgun: tilt forward to load shells
        reloadDY  = -wave * 0.07;
        reloadDZ  =  wave * 0.06;
        reloadRX  =  wave * 25;
        reloadRZ  =  Math.sin(prog * Math.PI * 2) * 5;  // wobble
      } else if (wid === 'lmg') {
        // LMG: heavy belt reload, big dip
        reloadDY  = -wave * 0.15;
        reloadRX  =  wave * 28;
        reloadRZ  =  Math.sin(prog * Math.PI * 1.5) * 10;
      } else if (wid === 'dmr') {
        // DMR: precise mag insert, tilt right
        reloadDY  = -wave * 0.10;
        reloadRX  =  wave * 20;
        reloadRZ  =  wave * 10;
      } else if (wid === 'burst') {
        // Burst: similar to M4
        reloadDY  = -wave * 0.11;
        reloadRX  =  wave * 20;
        reloadRZ  =  wave * 7;
      } else if (wid === 'rail') {
        // Rail gun: charge up motion, push forward then back
        reloadDZ  =  wave * 0.08;
        reloadDY  = -wave * 0.06;
        reloadRX  =  wave * 12;
        reloadRZ  =  Math.sin(prog * Math.PI * 2) * 4;
      } else if (wid === 'carbine') {
        // Carbine: compact mag swap
        reloadDY  = -wave * 0.09;
        reloadRX  =  wave * 17;
        reloadRZ  =  wave * 6;
      } else if (wid === 'rpg') {
        // RPG: tilt down to load rocket from below
        reloadDY  = -wave * 0.18;
        reloadRX  =  wave * 30;
        reloadRZ  = -wave * 8;  // tilt left (shoulder support)
      } else {
        // Default
        reloadDY  = -wave * 0.10;
        reloadRX  =  wave * 20;
        reloadRZ  =  wave * 7;
      }
    }

    grp.position.set(
      HIP_X + (ADS_X - HIP_X) * ads + bobX + reloadDX,
      HIP_Y + (ADS_Y - HIP_Y) * ads + recoilY + bobY + reloadDY,
      HIP_Z + (ADS_Z - HIP_Z) * ads + recoilZ + reloadDZ
    );

    if (isOBJ) {
      // Preserve Y=PI set at init; only animate X/Z
      grp.rotation.x = THREE.MathUtils.degToRad(reloadRX);
      grp.rotation.z = THREE.MathUtils.degToRad(reloadRZ);
    } else {
      grp.rotation.set(
        THREE.MathUtils.degToRad(reloadRX), 0,
        THREE.MathUtils.degToRad(reloadRZ)
      );
    }
  }

  getSnapshot(camCtrl) {
    // 활성 수류탄 위치 수집 → 상대방 화면에 렌더링 (Bug fix: grenades were not sent)
    const grenades = this.grenadeSystem
      ? this.grenadeSystem.grenades
          .filter(g => !g.exploded)
          .map(g => ({ px: g.mesh.position.x, py: g.mesh.position.y, pz: g.mesh.position.z }))
      : [];
    // 활성 로켓 위치/방향 수집
    const rockets = (this._rockets || [])
      .filter(r => r.alive)
      .map(r => ({
        px: r.pos.x, py: r.pos.y, pz: r.pos.z,
        vx: r.vel.x, vy: r.vel.y, vz: r.vel.z,
      }));
    return {
      pos:            this.pos.toArray(),
      yaw:            camCtrl.yaw,
      pitch:          camCtrl.pitch,
      move_time:      this.moveTime,
      bob_amp:        this.bobAmp,
      is_sliding:     this.isSliding,
      recoil:         this.recoilOffset,
      is_aiming:      this.isAiming,
      weapon_slot:    this.weaponSlot,
      loadout:        this.loadoutIds || [],
      is_reloading:   this.isReloading || this.sniperReloading || this.pistolReloading ||
                      this.rpgReloading ||
                      !!(this.weaponStates && Object.values(this.weaponStates).some(s => s.reloading)),
      reload_progress: (() => {
        if (this.isReloading)      return 1 - this.reloadTimer / this.reloadDuration;
        if (this.sniperReloading)  return 1 - this.sniperReloadTimer / this.sniperReloadDur;
        if (this.pistolReloading)  return 1 - this.pistolReloadTimer / this.pistolReloadDur;
        if (this.rpgReloading)     return 1 - this.rpgReloadTimer / (this.rpgReloadDur || 110);
        const ws = this.weaponStates;
        if (ws) for (const s of Object.values(ws)) {
          if (s.reloading) return 1 - s.reloadTimer / (s.reloadDur || 60);
        }
        return 0;
      })(),
      grenades,
      rockets,
    };
  }

  getWeaponKey() {
    return this.getLoadoutWeapon().id;
  }

  getWeaponProfile() {
    return this.weaponProfiles[this.getWeaponKey()];
  }

  _syncWeaponStats() {
    const key = this.getWeaponKey();
    const profile = this.weaponProfiles[key] || this.getLoadoutWeapon();
    const store = this.weaponAmmo[key] || this.weaponStates[key];
    this.ammo = store.ammo;
    this.totalAmmo = store.reserve;
    this.maxAmmo = profile.maxAmmo;
    this.maxTotalAmmo = profile.maxReserve || profile.reserve;
    this.reloadDuration = profile.reload;
    this.fireRate = profile.fireRate;
  }

  _writeWeaponAmmo() {
    const store = this.weaponAmmo[this.getWeaponKey()] || this.weaponStates[this.getWeaponKey()];
    store.ammo = this.ammo;
    store.reserve = this.totalAmmo;
  }

  applyKnockback(origin, force) {
    const dir = this.pos.clone().sub(origin);
    if (dir.lengthSq() < 0.001) dir.set(0, 1, 0);
    dir.normalize();
    // y 최솟값 보정 (너무 수평으로만 날아가지 않도록)
    if (dir.y < 0.15) { dir.y = 0.15; dir.normalize(); }
    dir.multiplyScalar(force);
    // 수평 knockback 속도 저장 → update()에서 매 프레임 반영 후 감쇠
    if (!this.knockbackVel) this.knockbackVel = new THREE.Vector3();
    this.knockbackVel.x += dir.x * 0.55;
    this.knockbackVel.z += dir.z * 0.55;
    // 즉시 수직 속도 반영
    this.yVel = Math.max(this.yVel, dir.y * 0.38);
    this.isJumping = true;
  }

  // ── RPG 발사체 생성 ──
  _fireRocket(camCtrl) {
    if (!this.renderer) return;
    const scene = this.renderer.scene;

    const yawRad   = THREE.MathUtils.degToRad(camCtrl.yaw);
    const pitchRad = THREE.MathUtils.degToRad(camCtrl.pitch);
    const dir = new THREE.Vector3(
      Math.cos(yawRad) * Math.cos(pitchRad),
      Math.sin(pitchRad),
      Math.sin(yawRad) * Math.cos(pitchRad)
    ).normalize();

    // 발사 위치: 카메라 위치에서 약간 앞
    const spawnPos = this.pos.clone();
    spawnPos.y += 1.5;
    spawnPos.addScaledVector(dir, 0.6);

    // ── 로켓 메시 (원통 몸체 + 원뿔 탄두) ──
    const group = new THREE.Group();

    // 몸체 (원통)
    const bodyGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.55, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.6, metalness: 0.4 });
    const body    = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.x = Math.PI / 2;
    group.add(body);

    // 탄두 (원뿔, 앞)
    const noseGeo = new THREE.ConeGeometry(0.045, 0.18, 8);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.8 });
    const nose    = new THREE.Mesh(noseGeo, noseMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = -0.37;  // 앞으로 (비행 방향)
    group.add(nose);

    // 날개 (4개)
    const finMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const finGeo = new THREE.BoxGeometry(0.005, 0.14, 0.16);
      const fin    = new THREE.Mesh(finGeo, finMat);
      fin.rotation.z = (i * Math.PI) / 2;
      fin.position.z = 0.22;  // 뒤쪽 날개
      group.add(fin);
    }

    // 분사구 글로우
    const exhaustGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const exhaustMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
    const exhaust    = new THREE.Mesh(exhaustGeo, exhaustMat);
    exhaust.position.z = 0.30;
    group.add(exhaust);

    // 그룹 방향을 비행 방향으로 정렬
    group.position.copy(spawnPos);
    group.lookAt(spawnPos.clone().add(dir));
    // lookAt은 +Z를 바라보도록 하므로 로켓 앞(nose)을 맞추기위해 Y축 180도 회전
    group.rotateY(Math.PI);
    scene.add(group);

    const wpn = getWeaponById('rpg');
    const rocket = {
      mesh:    group,
      exhaust,
      pos:     spawnPos.clone(),
      vel:     dir.clone().multiplyScalar(wpn.projectileSpeed),
      alive:   true,
      age:     0,
      _trailTimer: 0,
    };

    this._rockets.push(rocket);
    this.onRocketFire?.(rocket);
  }

  // ── 로켓 물리 업데이트 ──
  _updateRockets(dt) {
    if (!this._rockets || this._rockets.length === 0) return;
    const scene = this.renderer?.scene;
    if (!scene) return;

    const toRemove = [];
    for (const rocket of this._rockets) {
      if (!rocket.alive) { toRemove.push(rocket); continue; }

      rocket.age += dt;
      const scale = dt * 60;

      // 분사 파티클 트레일
      rocket._trailTimer += dt;
      if (rocket._trailTimer > 0.04 && this.renderer?.spawnSmokeParticle) {
        this.renderer.spawnSmokeParticle(rocket.pos.clone());
        rocket._trailTimer = 0;
      }
      // 분사구 글로우 깜빡임
      if (rocket.exhaust) rocket.exhaust.material.opacity = 0.7 + Math.random() * 0.3;

      // 이동
      const nextPos = rocket.pos.clone().addScaledVector(rocket.vel, scale);

      // ── 벽(박스) 충돌 ──
      let hitWall = false;
      for (const b of this.boxes) {
        const [bx, by, bz] = b.pos;
        const [sx, sy, sz] = b.size;
        const R = 0.12;
        if (nextPos.x > bx-sx-R && nextPos.x < bx+sx+R &&
            nextPos.y > by-sy-R && nextPos.y < by+sy+R &&
            nextPos.z > bz-sz-R && nextPos.z < bz+sz+R) {
          hitWall = true;
          break;
        }
      }

      // ── 플레이어 충돌 체크 (main.js의 onRocketHitCheck 콜백) ──
      let hitPlayer = false;
      if (!hitWall && this.onRocketHitCheck) {
        const result = this.onRocketHitCheck(rocket.pos, nextPos);
        if (result) hitPlayer = true;
      }

      if (hitWall || hitPlayer || rocket.age > 8) {
        // 폭발!
        rocket.alive = false;
        scene.remove(rocket.mesh);
        this.onRocketExplode?.(rocket.pos.clone(), hitPlayer);
        toRemove.push(rocket);
        continue;
      }

      rocket.pos.copy(nextPos);
      rocket.mesh.position.copy(nextPos);
    }

    for (const r of toRemove) {
      const idx = this._rockets.indexOf(r);
      if (idx !== -1) this._rockets.splice(idx, 1);
    }
  }
}
