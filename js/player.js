// player.js - 플레이어 물리/입력/무기 + OBJ 총모델 (m4a1.obj)

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export class Player {
  constructor(boxes, renderer) {
    this.pos    = new THREE.Vector3(0, 1, 5);
    this.yVel   = 0;

    this.playerRadius = 0.4;
    this.playerHeight = 1.8;

    this.baseSpeed = 0.08;
    this.gravity   = -0.015;
    this.jumpStr   = 0.25;
    this.isJumping = false;

    // 슬라이드/대시
    this.isSliding       = false;
    this.slideSpeed      = 0;
    this.slideDir        = new THREE.Vector3();
    this.dashCooldown    = 0;
    this.dashCooldownMax = 90;

    // 애니메이션
    this.moveTime    = 0;
    this.bobAmp      = 0;
    this.targetRoll  = 0;
    this.currentRoll = 0;
    this.recoilRoll  = 0;

    // 무기
    this.ammo          = 30;
    this.maxAmmo       = 30;
    this.isReloading   = false;
    this.reloadTimer   = 0;
    this.reloadDuration = 60;
    this.recoilOffset  = 0;
    this.isAiming      = false;
    this.adsProgress   = 0;
    this.fireMode      = 'AUTO';
    this.fireCooldown  = 0;
    this.fireRate      = 6;
    this.mKeyHeld      = false;
    this.mouseLeftHeld = false;

    // 체력
    this.health    = 100;
    this.maxHealth = 100;

    this.boxes    = boxes;
    this.renderer = renderer;

    // 입력
    this.keys  = {};
    this.mouse = { left: false, right: false };
    this._bindInput();

    // 콜백
    this.onShoot     = null;
    this.onHudUpdate = null;
    this.onDie       = null;

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

    // OBJ 비동기 로드
    this._loadGun(renderer);
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

        // ── obj 크기/방향 파악 후 정규화 ──
        // obj 좌표계: Z가 총구 방향, Y가 위, 단위가 크므로 스케일 다운
        const box3 = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box3.getSize(size);
        // 가장 긴 축을 기준으로 0.5 유닛으로 정규화
        const maxDim  = Math.max(size.x, size.y, size.z);
        const scale   = 0.5 / maxDim;

        // 중심을 원점으로 이동
        const center = new THREE.Vector3();
        box3.getCenter(center);

        // ── 1인칭 총 ──
        const gun1P = obj.clone(true);
        gun1P.scale.setScalar(scale);
        gun1P.position.set(
          -center.x * scale,
          -center.y * scale,
          -center.z * scale
        );
        // M4A1 obj: X=옆, Y=위, Z=총구 앞쪽 → Three 카메라는 -Z가 앞이므로 180도 회전
        gun1P.rotation.set(0, Math.PI, 0);
        this._fpWeaponGroup.add(gun1P);
        this._gunMesh1P = gun1P;

        // ── 3인칭 총 (bodyGroup의 _gunGroup3P에 삽입) ──
        const gun3P = obj.clone(true);
        // 3인칭은 좀 더 작게
        const scale3P = 0.35 / maxDim;
        gun3P.scale.setScalar(scale3P);
        gun3P.position.set(
          -center.x * scale3P,
          -center.y * scale3P,
          -center.z * scale3P
        );
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

    scene.add(this.bodyGroup);
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

  // ─────────────────────────────────────────
  // 사격
  // ─────────────────────────────────────────
  shoot(checkHitFn) {
    if (this.ammo <= 0 || this.isReloading) return;
    this.ammo--;
    this.recoilOffset = 0.3;
    this.recoilRoll   = (Math.random() * 6 - 3);
    if (checkHitFn)       checkHitFn();
    if (this.onShoot)     this.onShoot();
    if (this.onHudUpdate) this.onHudUpdate();
  }

  startReload() {
    if (this.ammo < this.maxAmmo && !this.isReloading) {
      this.isReloading = true;
      this.reloadTimer = this.reloadDuration;
      if (this.onHudUpdate) this.onHudUpdate();
    }
  }

  // ─────────────────────────────────────────
  // 메인 업데이트
  // ─────────────────────────────────────────
  update(camCtrl, checkHitFn) {
    const keys = this.keys, mouse = this.mouse;

    // ADS
    this.isAiming    = mouse.right && !this.isReloading;
    this.adsProgress += (this.isAiming ? 1 : -1) * 0.1;
    this.adsProgress  = Math.max(0, Math.min(1, this.adsProgress));

    // 반동 감쇠
    this.recoilOffset = Math.max(0, this.recoilOffset - 0.05);

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

    // M키 사격모드
    if (keys['KeyM']) {
      if (!this.mKeyHeld) {
        this.fireMode = this.fireMode === 'AUTO' ? 'SEMI' : 'AUTO';
        this.mKeyHeld = true;
        if (this.onHudUpdate) this.onHudUpdate();
      }
    } else { this.mKeyHeld = false; }

    // 사격
    this.fireCooldown = Math.max(0, this.fireCooldown - 1);
    if (mouse.left) {
      if (this.fireMode === 'AUTO') {
        if (this.fireCooldown === 0) { this.shoot(checkHitFn); this.fireCooldown = this.fireRate; }
      } else {
        if (!this.mouseLeftHeld) { this.shoot(checkHitFn); this.mouseLeftHeld = true; }
      }
    }

    // Roll
    this.targetRoll   = targetTilt;
    this.currentRoll += (this.targetRoll + this.recoilRoll - this.currentRoll) * 0.15;
    this.recoilRoll  *= 0.8;

    const isMoving = moveDir.length() > 0;
    if (isMoving) moveDir.normalize();

    // 워킹 밥
    if (isMoving && !this.isJumping && !this.isSliding) {
      this.moveTime += this.baseSpeed * 1.5;
      this.bobAmp   += (1 - this.bobAmp) * 0.1;
    } else {
      this.bobAmp += (0 - this.bobAmp) * 0.1;
    }

    // 대시 쿨다운
    if (this.dashCooldown > 0) {
      this.dashCooldown--;
      if (this.dashCooldown % 30 === 0 && this.onHudUpdate) this.onHudUpdate();
    }

    // 슬라이드
    if (keys['ShiftLeft'] && !this.isSliding && !this.isJumping && isMoving && this.dashCooldown <= 0) {
      this.isSliding  = true;
      this.slideSpeed = this.baseSpeed * 3.5;
      this.slideDir.copy(moveDir);
      this.dashCooldown = this.dashCooldownMax;
      if (this.onHudUpdate) this.onHudUpdate();
    }

    let actualMove = new THREE.Vector3();
    if (this.isSliding) {
      actualMove.copy(this.slideDir).multiplyScalar(this.slideSpeed);
      this.slideSpeed -= 0.015;
      if (this.slideSpeed <= this.baseSpeed) this.isSliding = false;
    } else {
      if (isMoving) actualMove.copy(moveDir).multiplyScalar(this.baseSpeed);
    }

    // 충돌 이동
    if (actualMove.length() > 0) {
      const tryX = this.pos.clone(); tryX.x += actualMove.x;
      if (!this.checkCollision(tryX)) this.pos.x = tryX.x;
      const tryZ = this.pos.clone(); tryZ.z += actualMove.z;
      if (!this.checkCollision(tryZ)) this.pos.z = tryZ.z;
    }

    // 점프
    if (keys['Space'] && !this.isJumping && !this.isSliding) {
      this.yVel = this.jumpStr;
      this.isJumping = true;
    }

    // 중력
    this.yVel += this.gravity;
    const tryY = this.pos.clone(); tryY.y += this.yVel;
    if (!this.checkCollision(tryY)) {
      this.pos.y = tryY.y;
    } else {
      if (this.yVel < 0) this.isJumping = false;
      this.yVel = 0;
    }

    // 리로드
    if (this.isReloading) {
      this.reloadTimer--;
      if (this.reloadTimer <= 0) {
        this.isReloading = false;
        this.ammo = this.maxAmmo;
        if (this.onHudUpdate) this.onHudUpdate();
      }
    }

    // 사망/추락
    if (this.health <= 0 || this.pos.y <= -20) {
      this.health = this.maxHealth;
      this.ammo   = this.maxAmmo;
      this.pos.set(0, 1, 5);
      this.yVel = 0;
      if (this.onDie)       this.onDie();
      if (this.onHudUpdate) this.onHudUpdate();
    }

    this._updateLocalBody(camCtrl);
    this._updateFirstPersonWeapon(camCtrl);
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
    // 3인칭이면 1인칭 무기 숨김
    this._fpWeaponGroup.visible = camCtrl.isFirstPerson;
    if (!camCtrl.isFirstPerson) return;

    const ads  = this.adsProgress;
    const hipX = 0.25, hipY = -0.85, hipZ = -0.15;
    const adsX = 0.0,  adsY = -0.75, adsZ =  0.25;

    const recoilZ = this.recoilOffset;
    const recoilY = this.recoilOffset * 0.1;

    const bobFactor = this.isAiming ? 0.2 : 1.0;
    const bobX = Math.cos(this.moveTime * 5)  * 0.006 * this.bobAmp * bobFactor;
    const bobY = Math.sin(this.moveTime * 10) * 0.006 * this.bobAmp * bobFactor;

    // 리로드 애니메이션
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
}
