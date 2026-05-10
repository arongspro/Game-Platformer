// player.js - 플레이어 물리/입력/무기 + OBJ 총모델 (m4a1.obj)

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

    // 슬라이드/대시
    this.isSliding       = false;
    this.slideSpeed      = 0;
    this.slideDir        = new THREE.Vector3();
    this.dashCooldown    = 0;
    this.dashCooldownMax = 10;

    // 애니메이션
    this.moveTime    = 0;
    this.bobAmp      = 0;
    this.targetRoll  = 0;
    this.currentRoll = 0;
    this.recoilRoll  = 0;
    this.recoilYaw   = 0;
    this.recoilPitch = 0;

    // 무기
    this.ammo          = 30;
    this.maxAmmo       = 30;
    this.totalAmmo     = 120;   // 총 예비 탄약
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

    // 체력
    this.health    = 100;
    this.maxHealth = 100;

    this.boxes    = boxes;
    this.renderer = renderer;

    // 무기 슬롯: 1=M4A1, 2=저격총, 5=권총, 4=수류탄
    this.weaponSlot    = 1;
    this.grenadeCount  = 3;        // 수류탄 재고
    this.maxGrenades   = 3;        // 수류탄 최대치

    // ── 저격총 ──
    this.sniperAmmo       = 5;
    this.sniperMaxAmmo    = 5;
    this.sniperTotalAmmo  = 20;
    this.sniperMaxTotal   = 20;
    this.sniperReloading  = false;
    this.sniperReloadTimer = 0;
    this.sniperReloadDur  = 120;
    this.isScopedIn       = false;
    this.scopeProgress    = 0;
    this.sniperFireCd     = 0;     // 발사 후 쿨타임
    this.sniperFireRate   = 15;    // 15프레임 쿨타임
    this._slot2Held       = false;

    // ── 권총 ──
    this.pistolAmmo       = 12;
    this.pistolMaxAmmo    = 12;
    this.pistolTotalAmmo  = 48;
    this.pistolMaxTotal   = 48;
    this.pistolReloading  = false;
    this.pistolReloadTimer = 0;
    this.pistolReloadDur  = 70;    // ~1.2초
    this.pistolFireCd     = 0;
    this.pistolFireRate   = 15;    // 반자동 쿨다운
    this._slot5Held       = false;
    this._spaceHeld       = false;

    // 붕대
    this.bandageCount    = 0;      // 현재 소지 (최대 1)
    this.maxBandage      = 1;
    this.isBandaging     = false;
    this.bandageTimer    = 0;
    this.bandageDuration = 90;     // 1.5초 (60fps 기준)
    this.grenadeCharge = 0;        // 좌클릭 홀드 시간 (0~60프레임)
    this.grenadeMaxCharge = 90;    // 최대 충전 프레임
    this.isChargingGrenade = false;
    this._slot4Held   = false;
    this._slot1Held   = false;
    this._slot2Held   = false;
    this._slot3Held   = false;
    this._slot2Held   = false;
    this._slot5Held   = false;

    // 수류탄 시스템 (renderer.scene 필요하므로 나중에 init)
    this.grenadeSystem = null;

    // 입력
    this.keys  = {};
    this.mouse = { left: false, right: false };
    this._bindInput();

    // 콜백
    this.onShoot      = null;
    this.onHudUpdate  = null;
    this.onDie        = null;
    this.onBandageUsed = null;

    // OBJ 로드 완료 후 채워질 메시 (그 전까진 null)
    this._gunMesh1P   = null;   // 1인칭 weaponScene용
    this._gunMesh3P   = null;   // 3인칭 bodyGroup용
    this._gunLoaded   = false;

    // 3인칭 바디 먼저 빌드 (총은 OBJ 로드 후 삽입)
    this._buildLocalBody(renderer);

    // 1인칭 무기 그룹 (OBJ 로드 후 메시 추가)
    this._fpWeaponGroup = new THREE.Group();
    this._fpWeaponGroup.position.set(0.25, -0.85, -0.15);
    renderer.weaponScene.add(this._fpWeaponGroup);

    // 1인칭 수류탄 그룹
    this._fpGrenadeGroup = new THREE.Group();
    this._fpGrenadeGroup.visible = false;
    const gGeo = new THREE.SphereGeometry(0.07, 8, 8);
    const gMat = new THREE.MeshLambertMaterial({ color: 0x2d4a1e });
    const gMesh = new THREE.Mesh(gGeo, gMat);
    // 핀
    const pinGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.06, 6);
    const pinMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    const pin = new THREE.Mesh(pinGeo, pinMat);
    pin.position.set(0.04, 0.07, 0);
    pin.rotation.z = Math.PI/4;
    this._fpGrenadeGroup.add(gMesh, pin);
    this._fpGrenadeGroup.position.set(0.18, -0.80, -0.40);
    renderer.weaponScene.add(this._fpGrenadeGroup);

    // ── 1인칭 저격총 그룹 (간단 박스 모델) ──
    this._fpSniperGroup = new THREE.Group();
    this._fpSniperGroup.visible = false;
    const sMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const sMat2 = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const sBody = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, 0.70), sMat);
    const sBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.30), sMat2);
    sBarrel.position.set(0, 0.015, -0.50);
    const sScope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.20, 8), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    sScope.rotation.x = Math.PI / 2;
    sScope.position.set(0, 0.06, 0.0);
    const sGrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), sMat2);
    sGrip.position.set(0, -0.085, 0.10);
    this._fpSniperGroup.add(sBody, sBarrel, sScope, sGrip);
    this._fpSniperGroup.position.set(0.22, -0.78, -0.55);
    renderer.weaponScene.add(this._fpSniperGroup);

    // ── 1인칭 권총 그룹 ──
    this._fpPistolGroup = new THREE.Group();
    this._fpPistolGroup.visible = false;
    const pMat3 = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.18), pMat3);
    const pBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.10), pMat3);
    pBarrel.position.set(0, 0.015, -0.14);
    const pGrip2 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.055), new THREE.MeshLambertMaterial({ color: 0x3a2a1a }));
    pGrip2.position.set(0, -0.10, 0.06);
    this._fpPistolGroup.add(pBody, pBarrel, pGrip2);
    this._fpPistolGroup.position.set(0.20, -0.75, -0.45);
    renderer.weaponScene.add(this._fpPistolGroup);

    // OBJ 비동기 로드
    this._loadGun(renderer);

    // 수류탄 시스템 초기화
    this.grenadeSystem = new GrenadeSystem(renderer.scene, boxes);
  }

  // ─────────────────────────────────────────
  // OBJ 로드
  // ─────────────────────────────────────────
  _loadGun(renderer) {
    const loader  = new OBJLoader();
    const gunMat  = new THREE.MeshLambertMaterial({
      color: 0x1a1a1a,
      map: renderer.getTexWeapon(),
    });

    loader.load(
      './m4a1.obj',          // index.html 기준 경로
      (obj) => {
        // 전체 머티리얼 통일 + 그림자
        obj.traverse(child => {
          if (child.isMesh) {
            child.material  = gunMat.clone();
            child.castShadow = true;
          }
        });

        // ── OBJ 크기 측정 후 정규화 ──
        const box3 = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box3.getSize(size);
        const center = new THREE.Vector3();
        box3.getCenter(center);
        const maxDim = Math.max(size.x, size.y, size.z);

        // ── 1인칭 총 ──
        // 0.65 유닛 크기로 (원본보다 크게)
        const scale = 0.65 / maxDim;
        const gun1P = obj.clone(true);
        gun1P.scale.setScalar(scale);
        // 중심을 원점으로 + 총구를 앞(-Z)으로 향하게 Y축 180도
        gun1P.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        gun1P.rotation.set(0, Math.PI, 0);
        this._fpWeaponGroup.add(gun1P);
        this._gunMesh1P = gun1P;

        // ── 3인칭 총 ──
        const scale3P = 0.45 / maxDim;
        const gun3P = obj.clone(true);
        gun3P.scale.setScalar(scale3P);
        gun3P.position.set(-center.x * scale3P, -center.y * scale3P, -center.z * scale3P);
        gun3P.rotation.set(0, Math.PI, 0);
        this._gunGroup3P.add(gun3P);
        this._gunMesh3P = gun3P;

        this._gunLoaded = true;
        console.log('[✅] m4a1.obj 로드 완료, scale=', scale.toFixed(4));
      },
      (xhr) => {
        if (xhr.total) console.log(`[🔃] m4a1.obj ${(xhr.loaded/xhr.total*100).toFixed(0)}%`);
      },
      (err) => {
        console.warn('[⚠️] m4a1.obj 로드 실패, 박스 대체 사용:', err);
        // 폴백: 박스로 대체
        this._buildFallbackGun(renderer);
      }
    );
  }

  // OBJ 로드 실패 시 박스 대체 총
  _buildFallbackGun(renderer) {
    const gMat = new THREE.MeshLambertMaterial({ color: 0x222222, map: renderer.getTexWeapon() });
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
  // 로컬 3인칭 바디
  // ─────────────────────────────────────────
  _buildLocalBody(renderer) {
    const scene = renderer.scene;
    const pMat  = (col) => new THREE.MeshLambertMaterial({ color: col, map: renderer.getTexPlayer() });
    const box   = (sx,sy,sz) => new THREE.BoxGeometry(sx*2, sy*2, sz*2);

    this.bodyGroup = new THREE.Group();
    this.bodyGroup.visible = false;

    // 몸통
    const body = new THREE.Mesh(box(0.4,0.6,0.25), pMat(0x3366aa));
    body.position.y = 1.0; body.castShadow = true;
    this.bodyGroup.add(body);

    // 머리 pivot
    this._headPivot = new THREE.Group();
    this._headPivot.position.y = 1.7;
    const head = new THREE.Mesh(box(0.25,0.25,0.25), pMat(0x4477bb));
    head.castShadow = true; this._headPivot.add(head);
    this.bodyGroup.add(this._headPivot);

    // 왼다리
    this._legLPivot = new THREE.Group();
    this._legLPivot.position.set(-0.25, 1.0, 0);
    const legL = new THREE.Mesh(box(0.2,0.7,0.2), pMat(0x2255aa));
    legL.position.y = -0.7; legL.castShadow = true; this._legLPivot.add(legL);
    this.bodyGroup.add(this._legLPivot);

    // 오른다리
    this._legRPivot = new THREE.Group();
    this._legRPivot.position.set(0.25, 1.0, 0);
    const legR = new THREE.Mesh(box(0.2,0.7,0.2), pMat(0x2255aa));
    legR.position.y = -0.7; legR.castShadow = true; this._legRPivot.add(legR);
    this.bodyGroup.add(this._legRPivot);

    // 오른팔
    this._armRPivot = new THREE.Group();
    this._armRPivot.position.set(0.45, 1.4, 0.05);
    const armR = new THREE.Mesh(box(0.15,0.6,0.15), pMat(0x3366aa));
    armR.position.y = -0.6; armR.castShadow = true; this._armRPivot.add(armR);
    this.bodyGroup.add(this._armRPivot);

    // 왼팔
    this._armLPivot = new THREE.Group();
    this._armLPivot.position.set(-0.45, 1.4, 0.05);
    const armL = new THREE.Mesh(box(0.15,0.7,0.15), pMat(0x3366aa));
    armL.position.y = -0.7; armL.castShadow = true; this._armLPivot.add(armL);
    this.bodyGroup.add(this._armLPivot);

    // 총 그룹 (OBJ 로드 후 메시가 추가될 빈 그룹)
    this._gunGroup3P = new THREE.Group();
    this._gunGroup3P.position.set(0.35, 1.22, 1.2);
    this.bodyGroup.add(this._gunGroup3P);

    // 픽셀 텍스처 적용 대상 메시 목록
    this._bodyMeshes = [body, head, legL, legR, armR, armL];

    scene.add(this.bodyGroup);
  }

  // ── 로컬 픽셀 → 부위별 평균색으로 단색 적용 ──
  // BoxGeometry는 UV가 각 면마다 0~1이라 16x16 DataTexture를 올리면
  // 텍스처 전체가 늘어나 검게 보임. 대신 평균색을 material.color에 직접 설정.
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
      if (n === 0) return new THREE.Color(0x556688); // 기본색
      return new THREE.Color(r/n/255, g/n/255, b/n/255);
    };

    const [body, head, legL, legR, armR, armL] = this._bodyMeshes;
    const setColor = (mesh, color) => {
      mesh.material.map   = null;   // 텍스처 제거 (검은색 원인)
      mesh.material.color.copy(color);
      mesh.material.needsUpdate = true;
    };

    setColor(head, avg(4, 11,  0,  4));   // 머리
    setColor(body, avg(3, 12,  5, 10));   // 몸통
    setColor(legL, avg(4,  7, 11, 15));   // 왼다리
    setColor(legR, avg(8, 11, 11, 15));   // 오른다리
    setColor(armR, avg(13,15,  5,  9));   // 오른팔
    setColor(armL, avg(0,  2,  5,  9));   // 왼팔
  }

  // ─────────────────────────────────────────
  // 입력
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
  // 충돌
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
  // 사격
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

  // 보급상자에서 리필
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
    // 재장전은 점프/이동 중에도 가능 (canUseBaseAction은 붕대 전용)
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
  // 메인 업데이트
  // ─────────────────────────────────────────
  update(camCtrl, checkHitFn, dt = 1/60) {
    // 60fps 기준으로 정규화된 스케일 (FPS 독립적 물리)
    const scale = dt * 60;
    const keys = this.keys, mouse = this.mouse;

    // ADS
    this.isAiming    = mouse.right && !this.isReloading;
    this.adsProgress += (this.isAiming ? 1 : -1) * 0.1 * scale;
    this.adsProgress  = Math.max(0, Math.min(1, this.adsProgress));

    // 반동 감쇠
    this.recoilOffset = Math.max(0, this.recoilOffset - 0.05 * scale);
    if (camCtrl) {
      camCtrl.yaw += this.recoilYaw;
      camCtrl.pitch = Math.max(-89, Math.min(89, camCtrl.pitch + this.recoilPitch));
      this.recoilYaw   *= Math.pow(0.58, scale);
      this.recoilPitch *= Math.pow(0.52, scale);
    }

    // 이동 방향
    const yawRad = THREE.MathUtils.degToRad(camCtrl.yaw);
    const front  = new THREE.Vector3(Math.cos(yawRad), 0, Math.sin(yawRad));
    const right  = new THREE.Vector3(-Math.sin(yawRad), 0, Math.cos(yawRad));
    const moveDir = new THREE.Vector3();
    let targetTilt = 0;

    if (keys['KeyW']) moveDir.addScaledVector(front,  1);
    if (keys['KeyS']) moveDir.addScaledVector(front, -1);
    if (keys['KeyA']) { moveDir.addScaledVector(right, -1); targetTilt -= 3; }
    if (keys['KeyD']) { moveDir.addScaledVector(right,  1); targetTilt += 3; }

    // 무기 슬롯 전환
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

    // M키 사격모드 (M4A1 슬롯에서만, 저격/권총은 SEMI 고정)
    if (this.weaponSlot === 1) {
      if (keys['KeyM']) {
        if (!this.mKeyHeld) {
          this.fireMode = this.fireMode === 'AUTO' ? 'SEMI' : 'AUTO';
          this.mKeyHeld = true;
          if (this.onHudUpdate) this.onHudUpdate();
        }
      } else { this.mKeyHeld = false; }
    }

    // ── 슬롯별 좌클릭 동작 ──
    this.fireCooldown = Math.max(0, this.fireCooldown - scale);
    this.pistolFireCd = Math.max(0, this.pistolFireCd - scale);
    this.sniperFireCd = Math.max(0, this.sniperFireCd - scale);
    for (const state of Object.values(this.weaponStates)) {
      state.cooldown = Math.max(0, state.cooldown - scale);
    }

    // 저격총 우클릭 시 자동 1인칭 전환
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
      // ── 저격총: SEMI, 우클릭 스코프 ──
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

      // 자동 리로드 (탄이 0이면)
      if (this.sniperAmmo === 0 && !this.sniperReloading && this.sniperTotalAmmo > 0) {
        this.sniperReloading = true;
        this.sniperReloadTimer = this.sniperReloadDur;
        if (this.onHudUpdate) this.onHudUpdate();
      }
      this.isChargingGrenade = false;
      this.grenadeCharge = 0;
      this.isBandaging = false;

    } else if (false && this.weaponSlot === 5) {
      // ── 권총: SEMI ──
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

      // 자동 리로드
      if (this.pistolAmmo === 0 && !this.pistolReloading && this.pistolTotalAmmo > 0) {
        this.pistolReloading = true;
        this.pistolReloadTimer = this.pistolReloadDur;
        if (this.onHudUpdate) this.onHudUpdate();
      }
      this.isChargingGrenade = false;
      this.grenadeCharge = 0;
      this.isBandaging = false;

    } else if (this.weaponSlot === 4) {
      // 수류탄: 좌클릭 홀드로 충전, 떼면 투척
      if (mouse.left && this.grenadeCount > 0) {
        this.isChargingGrenade = true;
        this.grenadeCharge = Math.min(this.grenadeCharge + 1, this.grenadeMaxCharge);
      } else if (!mouse.left && this.isChargingGrenade) {
        // 마우스 뗌 → 투척
        const power = this.grenadeCharge / this.grenadeMaxCharge;
        if (this.grenadeSystem) {
          const yawRad = THREE.MathUtils.degToRad(camCtrl.yaw);
          const throwFront = new THREE.Vector3(Math.cos(yawRad), 0, Math.sin(yawRad));
          this.grenadeSystem.throw(this.pos.clone(), throwFront, camCtrl.pitch, power);
          this.grenadeCount--;
          if (this.grenadeCount === 0) this.weaponSlot = 1; // 다 쓰면 총으로
        }
        this.grenadeCharge = 0;
        this.isChargingGrenade = false;
        if (this.onHudUpdate) this.onHudUpdate();
      }
      this.isBandaging = false;

    } else if (this.weaponSlot === 3) {
      // 붕대: 좌클릭 홀드 1.5초 → 30 HP 회복
      if (mouse.left && this.bandageCount > 0 && this.health < this.maxHealth && !this.isBandaging && this.canUseBaseAction?.()) {
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

    // 워킹 밥
    if (isMoving && !this.isJumping && !this.isSliding) {
      this.moveTime += this.baseSpeed * 2.25 * scale;
      this.bobAmp   += (1 - this.bobAmp) * 0.1 * scale;
    } else {
      this.bobAmp += (0 - this.bobAmp) * 0.1 * scale;
    }

    // 대시 쿨다운
    if (this.dashCooldown > 0) {
      this.dashCooldown -= scale;
      if (this.dashCooldown < 0) this.dashCooldown = 0;
      if (this.onHudUpdate) this.onHudUpdate();
    }

    // 슬라이드 시작
    if (keys['ShiftLeft'] && !this.isSliding && !this.isJumping && isMoving && this.dashCooldown <= 0) {
      this.isSliding  = true;
      this.slideSpeed = this.baseSpeed * 6.8;
      this.slideDir.copy(moveDir);
      this.dashCooldown = this.dashCooldownMax;
      if (this.onHudUpdate) this.onHudUpdate();
    }

    // 점프 (슬라이드 중에도 가능 → 슬라이드 취소 후 점프)
    const spacePressed = keys['Space'] && !this._spaceHeld;
    if (keys['Space'] && !this.isJumping) {
      this.isSliding = false;   // 슬라이드 즉시 취소
      this.yVel      = this.jumpStr;
      this.isJumping = true;
    }
    this._spaceHeld = !!keys['Space'];

    let actualMove = new THREE.Vector3();
    if (this.isSliding) {
      actualMove.copy(this.slideDir).multiplyScalar(this.slideSpeed * scale);
      this.slideSpeed -= 0.045 * scale;   // dt 기반 감속
      if (this.slideSpeed <= this.baseSpeed) this.isSliding = false;
    } else {
      if (isMoving) actualMove.copy(moveDir).multiplyScalar((this.baseSpeed + this.speedBoost) * scale);
    }

    // 충돌 이동
    if (actualMove.length() > 0) {
      const tryX = this.pos.clone(); tryX.x += actualMove.x;
      if (!this.checkCollision(tryX)) this.pos.x = tryX.x;
      const tryZ = this.pos.clone(); tryZ.z += actualMove.z;
      if (!this.checkCollision(tryZ)) this.pos.z = tryZ.z;
    }

    // 중력
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

    // 리로드
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

    // 저격총 리로드
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

    // 권총 리로드
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

    // 붕대 사용 타이머
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
      // 마우스 떼거나 이동하면 취소
      if (!this.mouse.left) {
        this.isBandaging = false;
        this.bandageTimer = 0;
      }
    }

    // 사망/추락
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
      this.bandageCount = 0;          // 붕대는 죽으면 소멸
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
    if (this.grenadeSystem) this.grenadeSystem.update();
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
  // 3인칭 바디 업데이트
  // ─────────────────────────────────────────
  _updateLocalBody(camCtrl) {
    const fp = camCtrl.isFirstPerson;
    this.bodyGroup.visible = !fp;
    if (fp) return;

    const slideOffset = this.isSliding ? -0.6 : 0;
    this.bodyGroup.position.set(this.pos.x, this.pos.y + 0.4 + slideOffset, this.pos.z);
    this.bodyGroup.rotation.y = -THREE.MathUtils.degToRad(camCtrl.yaw) - Math.PI / 2;

    // 머리 pitch
    this._headPivot.rotation.x = THREE.MathUtils.degToRad(-camCtrl.pitch);

    // 다리 스윙
    const swing = this.isSliding ? 0 : Math.sin(this.moveTime * 6) * (20 * Math.PI/180) * this.bobAmp;
    this._legLPivot.rotation.x = this.isSliding ?  (70*Math.PI/180) :  swing;
    this._legRPivot.rotation.x = this.isSliding ? -(70*Math.PI/180) : -swing;

    // 팔
    const ads = this.adsProgress;
    this._armRPivot.rotation.x = THREE.MathUtils.degToRad(65 - ads*15);
    this._armRPivot.rotation.z = THREE.MathUtils.degToRad(-20 + ads*10);
    this._armLPivot.rotation.x = THREE.MathUtils.degToRad(45 + ads*10);
    this._armLPivot.rotation.z = THREE.MathUtils.degToRad( 40 - ads*20);

    // 총 반동
    this._gunGroup3P.rotation.x = -this.recoilOffset * 0.3;
  }

  // ─────────────────────────────────────────
  // 1인칭 무기 업데이트 (Python draw_first_person_weapon 직역)
  // ─────────────────────────────────────────
  _updateFirstPersonWeapon(camCtrl) {
    const fp = camCtrl.isFirstPerson;
    const equipped = this.getLoadoutWeapon();

    // 슬롯에 따라 표시/숨김
    this._fpWeaponGroup.visible  = fp && !equipped.scope && (this.weaponSlot === 1 || this.weaponSlot === 2);
    this._fpGrenadeGroup.visible = fp && this.weaponSlot === 4;
    // 저격총/권총은 별도 그룹 (없으면 기본 총 그룹 재활용)
    if (this._fpSniperGroup) this._fpSniperGroup.visible = fp && equipped.scope;
    if (this._fpPistolGroup) this._fpPistolGroup.visible = fp && this.weaponSlot === 5 && !equipped.scope;

    if (!fp) return;

    // ── 수류탄 슬롯 애니메이션 ──
    if (this.weaponSlot === 4) {
      const charge = this.grenadeCharge / this.grenadeMaxCharge;
      const bob = Math.sin(this.moveTime * 10) * 0.004 * this.bobAmp;
      this._fpGrenadeGroup.position.set(
        0.18 + charge * 0.04,
        -0.80 - charge * 0.08 + bob,
        -0.40 + charge * 0.12
      );
      this._fpGrenadeGroup.rotation.set(
        Math.sin(this.moveTime * 7) * 0.02 * this.bobAmp,
        Math.PI * 0.05,
        charge * -0.15
      );
      return;
    }

    const ads  = this.adsProgress;
    const hipX = 0.22, hipY = -0.78, hipZ = -0.55;
    const adsX = 0.0,  adsY = -0.68, adsZ = -0.30;

    const recoilZ = this.recoilOffset;
    const recoilY = this.recoilOffset * 0.1;

    const bobFactor = this.isAiming ? 0.2 : 1.0;
    const bobX = Math.cos(this.moveTime * 5)  * 0.006 * this.bobAmp * bobFactor;
    const bobY = Math.sin(this.moveTime * 10) * 0.006 * this.bobAmp * bobFactor;

    // ── 저격총 슬롯 ──
    if (equipped.scope) {
      const scope = this.scopeProgress;
      // 스코프 시 중앙으로, 손 떨림 최소화
      const sx = 0.22 + (0.0 - 0.22) * scope;
      const sy = -0.78 + (0.68 - 0.78) * scope;  // 살짝 위로
      const sz = -0.55 + (-0.20 + 0.55) * scope;  // 더 앞으로
      let grp = this._fpSniperGroup || this._fpWeaponGroup;
      const bx = Math.cos(this.moveTime * 5)  * 0.006 * this.bobAmp * (scope > 0.5 ? 0.1 : 1.0);
      const by = Math.sin(this.moveTime * 10) * 0.006 * this.bobAmp * (scope > 0.5 ? 0.1 : 1.0);
      grp.position.set(sx + bx, sy + recoilY + by, sz + recoilZ);
      grp.rotation.set(
        THREE.MathUtils.degToRad(0),
        Math.PI,
        THREE.MathUtils.degToRad(0)
      );
      return;
    }

    // ── 권총 슬롯 ──
    if (this.weaponSlot === 5) {
      let grp = this._fpPistolGroup || this._fpWeaponGroup;
      const isAimingP = this.mouse.right;
      const pAds = this.adsProgress;
      const px = hipX + (adsX - hipX) * pAds + bobX;
      const py = hipY + (adsY - hipY) * pAds + recoilY + bobY;
      const pz = hipZ + (adsZ - hipZ) * pAds + recoilZ;
      grp.position.set(px, py, pz);
      grp.rotation.set(0, Math.PI, 0);
      return;
    }

    // ── M4A1 슬롯 ──
    let reloadY = 0, reloadRX = 0, reloadRZ = 0;
    if (this.isReloading) {
      const prog = 1 - (this.reloadTimer / this.reloadDuration);
      reloadY  = -Math.sin(prog * Math.PI) * 0.5;
      reloadRX =  Math.sin(prog * Math.PI) * 60;
      reloadRZ =  Math.sin(prog * Math.PI) * 30;
    }

    const curX = hipX + (adsX - hipX) * ads + bobX;
    const curY = hipY + (adsY - hipY) * ads + recoilY + bobY + reloadY;
    const curZ = hipZ + (adsZ - hipZ) * ads + recoilZ;

    this._fpWeaponGroup.position.set(curX, curY, curZ);
    this._fpWeaponGroup.rotation.set(
      THREE.MathUtils.degToRad(reloadRX),
      Math.PI,
      THREE.MathUtils.degToRad(reloadRZ)
    );
  }

  getSnapshot(camCtrl) {
    return {
      pos:        this.pos.toArray(),
      yaw:        camCtrl.yaw,
      pitch:      camCtrl.pitch,
      move_time:  this.moveTime,
      bob_amp:    this.bobAmp,
      is_sliding: this.isSliding,
      recoil:     this.recoilOffset,
      is_aiming:  this.isAiming,
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
    dir.y = Math.max(0.35, dir.y + 0.2);
    if (dir.lengthSq() < 0.001) dir.set(0, 1, 0);
    dir.normalize().multiplyScalar(force);
    this.pos.addScaledVector(dir, 0.35);
    this.yVel = Math.max(this.yVel, dir.y * 0.18);
    this.isJumping = true;
  }
}
