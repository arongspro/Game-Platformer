// renderer.js - Three.js 씬, 조명, 맵, 원격 플레이어 풀바디

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.width  = window.innerWidth;
    this.height = window.innerHeight;

    // ── WebGL Renderer ──
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled  = true;
    this.renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace   = THREE.SRGBColorSpace;
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.setClearColor(0x6699cc);

    // ── 메인 씬 ──
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x6699cc, 80, 300);
    this.scene.background = new THREE.Color(0x6699cc);

    // ── 카메라 ──
    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.05, 400);

    // ── 무기 씬 (1인칭 오버레이) ──
    this.weaponScene  = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(50, this.width / this.height, 0.001, 50);
    this.weaponScene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const wl = new THREE.DirectionalLight(0xffffff, 0.8);
    wl.position.set(1, 2, 3);
    this.weaponScene.add(wl);

    this._buildTextures();
    this._setupLights();
    this._buildWorld();
    this.particles = [];

    // 공유 OBJ 총 (원격 플레이어용)
    this._sharedGunObj    = null;
    this._sharedGunScale  = 1;
    this._sharedGunCenter = new THREE.Vector3();
    this._loadSharedGun();

    window.addEventListener('resize', () => this._onResize());
  }

  // ── 텍스처 ──
  _makeTex(c1, c2, pattern = 'checker') {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let on;
        if      (pattern === 'checker') on = ((Math.floor(x/8) + Math.floor(y/8)) % 2 === 0);
        else if (pattern === 'stripe')  on = (x % 16 < 8);
        else                            on = (Math.random() > 0.5);
        const col = on ? c1 : c2;
        const i = (y * size + x) * 4;
        data[i]=col[0]; data[i+1]=col[1]; data[i+2]=col[2]; data[i+3]=255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size);
    tex.colorSpace  = THREE.SRGBColorSpace;
    tex.magFilter   = THREE.NearestFilter;
    tex.minFilter   = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  _buildTextures() {
    this.texChecker = this._makeTex([255,255,255],[150,150,150],'checker');
    this.texStripe  = this._makeTex([255,200,100],[200,100,50], 'stripe');
    this.texNoise   = this._makeTex([100,200,100],[50,100,50],  'noise');
    this.texSolid   = this._makeTex([200,200,200],[200,200,200],'checker');
    this.texPlayer  = this._makeTex([50,100,200], [30,80,180],  'noise');
    this.texWeapon  = this._makeTex([60,60,60],   [40,40,40],   'noise');
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));

    this.sunLight = new THREE.DirectionalLight(0xfff0cc, 1.8);
    this.sunLight.position.set(-20, 60, -20);
    this.sunLight.castShadow = true;
    const sh = this.sunLight.shadow;
    sh.mapSize.set(2048, 2048);
    sh.camera.near = 1; sh.camera.far = 250;
    sh.camera.left = -100; sh.camera.right  = 100;
    sh.camera.top  =  100; sh.camera.bottom = -100;
    sh.bias = -0.0003;
    this.scene.add(this.sunLight);

    const fill = new THREE.DirectionalLight(0xaaccff, 0.4);
    fill.position.set(20, 20, 20);
    this.scene.add(fill);
  }

  _buildWorld() {
    this.boxMeshes = [];
    const T = { checker:this.texChecker, stripe:this.texStripe, noise:this.texNoise, solid:this.texSolid };

    const boxes = [
      // === 기존 맵 데이터 ===
      [0,-30,80,   400,1,400,  0x0d0d15,'checker'],
      [0,0,0,      15,1,15,    0xccccda,'checker'],
      [-14,1.5,-14,0.5,1,0.5,  0xb39933,'stripe'],
      [14,1.5,-14, 0.5,1,0.5,  0xb39933,'stripe'],
      [-14,1.5,14, 0.5,1,0.5,  0xb39933,'stripe'],
      [14,1.5,14,  0.5,1,0.5,  0xb39933,'stripe'],
      [0,1,12,     4,0.5,4,    0x7fa0b3,'solid'],
      [0,2,15,     4,0.5,4,    0x7fa0b3,'solid'],
      [0,3,18,     4,0.5,4,    0x7fa0b3,'solid'],
      [0,4,21,     4,0.5,4,    0x7fa0b3,'solid'],
      [0,5,35,     15,1,15,    0x4d5966,'checker'],
      [-6,6.5,37,  2,1,2,      0x666666,'stripe'],
      [8,6.8,40,   1.5,1.3,1.5,0x666666,'stripe'],
      [-4,6.2,45,  3,0.7,1.5,  0x666666,'stripe'],
      [5,6.5,47,   1,1,3,      0x666666,'stripe'],
      [-13,8,42,   1,3,1,      0x333333,'solid'],
      [-13,11.5,42,1.5,0.5,1.5,0xccb833,'solid'],
      [13,8,42,    1,3,1,      0x333333,'solid'],
      [13,11.5,42, 1.5,0.5,1.5,0xccb833,'solid'],
      [0,6,54,     3,0.2,3,    0xe69a1a,'solid'],
      [-4,7,60,    3,0.2,3,    0xe69a1a,'solid'],
      [-8,8,66,    3,0.2,3,    0xe69a1a,'solid'],
      [-4,9,72,    3,0.2,3,    0xe69a1a,'solid'],
      [0,10,78,    3,0.2,3,    0xe69a1a,'solid'],
      [4,11,84,    3,0.2,3,    0xe69a1a,'solid'],
      [0,12,90,    3,0.2,3,    0xe69a1a,'solid'],
      [0,13,99,    10,0.5,10,  0xccd9e6,'checker'],
      [-8,14.5,99, 1,1.5,1,    0x999999,'solid'],
      [8,14.5,99,  1,1.5,1,    0x999999,'solid'],
      [0,16.5,99,  9,0.5,1,    0x999999,'solid'],
      [0,15,99,    2,2,2,      0xffcc33,'noise'],
      [0,14,109,   4,0.5,4,    0x80b3e6,'solid'],
      [0,15,115,   3,0.5,3,    0x80b3e6,'solid'],
      [0,16,121,   3,0.5,3,    0x80b3e6,'solid'],
      [-5,17,124,  3,0.2,3,    0xe63333,'solid'],
      [-11,18,126, 3,0.2,3,    0xe63333,'solid'],
      [-14,19,128, 3,0.2,3,    0xe63333,'solid'],
      [-11,20,130, 3,0.2,3,    0xe63333,'solid'],
      [-5,21,132,  3,0.2,3,    0xe63333,'solid'],
      [0,22,136,   3,0.2,3,    0xe63333,'solid'],
      [0,23,162,   25,1,25,    0xf2f2ff,'checker'],
      [-15,27.5,152,2,10,2,    0xccccdd,'stripe'],
      [15,27.5,152, 2,10,2,    0xccccdd,'stripe'],
      [0,32,152,   32,1,4,     0xccccdd,'solid'],
      [0,25,152,   3,4,3,      0x9933dd,'noise'],
      [0,29,152,   1.5,1.5,1.5,0xe6ccff,'noise'],

      // === 수정된 확장 맵 구역 (겹침 현상 해결) ===

      // 1. 거대 구역으로 이어지는 징검다리 구간 (기존 맵 끝에서 부드럽게 이어짐)
      [0, 24, 173,   4, 0.5, 4,    0x7fa0b3, 'solid'],
      [0, 25, 183,   3, 0.5, 3,    0x7fa0b3, 'solid'],
      [0, 26, 193,   3, 0.5, 3,    0x7fa0b3, 'solid'],
      [0, 27, 203,   3, 0.5, 3,    0x7fa0b3, 'solid'],

      // 2. 중간 아레나 구역 (징검다리를 덮지 않도록 Z축을 225로 뒤로 완전히 뺌)
      [0, 28, 250,   35, 0.5,  35,    0x4d6659, 'checker'], // 중앙 아레나 바닥
      [-15, 32, 225, 2, 8, 2,      0x88aa99, 'stripe'],  // 아레나 왼쪽 기둥
      [15, 32, 225,  2, 8, 2,      0x88aa99, 'stripe'],  // 아레나 오른쪽 기둥
      [0, 32, 210,   2, 8, 2,      0x88aa99, 'stripe'],  // 아레나 입구 기둥
      [0, 30, 225,   6, 3, 6,      0x33e699, 'noise'],   // 아레나 중앙 조형물
      [0, 34, 225,   2, 2, 2,      0xffffff, 'noise'],   // 중앙 조형물 장식

      // 3. 지그재그 고공 등반 구간 (아레나 끝에서부터 다시 시작)
      [10, 30, 252,  4, 0.2, 4,    0xe6e61a, 'solid'],
      [20, 32, 262,  4, 0.2, 4,    0xe6e61a, 'solid'],
      [10, 34, 272,  4, 0.2, 4,    0xe6e61a, 'solid'],
      [0, 36, 282,   4, 0.2, 4,    0xe6e61a, 'solid'],
      [-10, 38, 292, 4, 0.2, 4,    0xe6e61a, 'solid'],
      [-20, 40, 302, 4, 0.2, 4,    0xe6e61a, 'solid'],
      [-10, 42, 312, 4, 0.2, 4,    0xe6e61a, 'solid'],
      [0, 43, 322,   4, 0.2, 4,    0xe6e61a, 'solid'], // 보스룸 진입용 마지막 징검다리

      // 4. 최종 보스 룸 / 거대 신전 구역 (징검다리를 덮지 않도록 Z축을 350으로 멀리 배치)
      [0, 43.5, 350, 50, 1, 50,    0x1a1a24, 'checker'], // 거대 흑요석 바닥
      [-22, 55, 330, 4, 25, 4,     0xcc3333, 'stripe'],  // 신전 기둥 (좌전방)
      [22, 55, 330,  4, 25, 4,     0xcc3333, 'stripe'],  // 신전 기둥 (우전방)
      [-22, 55, 370, 4, 25, 4,     0xcc3333, 'stripe'],  // 신전 기둥 (좌후방)
      [22, 55, 370,  4, 25, 4,     0xcc3333, 'stripe'],  // 신전 기둥 (우후방)
      
      // 신전 중앙 제단 및 코어
      [0, 45, 350,   15, 2, 15,    0x333344, 'solid'],   // 제단 1단
      [0, 47, 350,   10, 2, 10,    0x444455, 'solid'],   // 제단 2단
      [0, 51, 350,   4, 8, 4,      0xffaa00, 'noise'],   // 코어 조형물
      [0, 56, 350,   8, 1, 8,      0xffcc00, 'solid']    // 코어 황금 지붕
];

    boxes.forEach(([x,y,z, sx,sy,sz, hex, tk]) => {
      const geo  = new THREE.BoxGeometry(sx*2, sy*2, sz*2);
      const mat  = new THREE.MeshLambertMaterial({ color: hex, map: T[tk] });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.boxMeshes.push({ pos:[x,y,z], size:[sx,sy,sz] });
    });
  }

  // ── 원격 플레이어 풀바디 (Python draw_player_full 직역) ──
  _buildPlayerGroup() {
    const group = new THREE.Group();
    const pMat  = (col) => new THREE.MeshLambertMaterial({ color: col, map: this.texPlayer });
    const gMat  = ()    => new THREE.MeshLambertMaterial({ color: 0x222222, map: this.texWeapon });

    const box = (sx,sy,sz) => new THREE.BoxGeometry(sx*2, sy*2, sz*2);

    // 몸통
    const body = new THREE.Mesh(box(0.4,0.6,0.25), pMat(0x5080cc));
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);

    // 머리 (pivot at y=1.7)
    const headPivot = new THREE.Group();
    headPivot.position.y = 1.7;
    const head = new THREE.Mesh(box(0.25,0.25,0.25), pMat(0x6090dd));
    head.castShadow = true;
    headPivot.add(head);
    group.add(headPivot);

    // 왼다리 pivot (원본: [-0.25,0.3,0], swing around X at pivot_y 0.7)
    const legLPivot = new THREE.Group();
    legLPivot.position.set(-0.25, 1.0, 0); // pivot을 몸통 상단에
    const legLMesh = new THREE.Mesh(box(0.2,0.7,0.2), pMat(0x4070bb));
    legLMesh.position.y = -0.7;
    legLMesh.castShadow = true;
    legLPivot.add(legLMesh);
    group.add(legLPivot);

    // 오른다리
    const legRPivot = new THREE.Group();
    legRPivot.position.set(0.25, 1.0, 0);
    const legRMesh = new THREE.Mesh(box(0.2,0.7,0.2), pMat(0x4070bb));
    legRMesh.position.y = -0.7;
    legRMesh.castShadow = true;
    legRPivot.add(legRMesh);
    group.add(legRPivot);

    // 오른팔 (총 드는 쪽, shoulder_y=1.4)
    const armRPivot = new THREE.Group();
    armRPivot.position.set(0.45, 1.4, 0.05);
    const armRMesh = new THREE.Mesh(box(0.15,0.6,0.15), pMat(0x5080cc));
    armRMesh.position.y = -0.6;
    armRMesh.castShadow = true;
    armRPivot.add(armRMesh);
    group.add(armRPivot);

    // 왼팔
    const armLPivot = new THREE.Group();
    armLPivot.position.set(-0.45, 1.4, 0.05);
    const armLMesh = new THREE.Mesh(box(0.15,0.7,0.15), pMat(0x5080cc));
    armLMesh.position.y = -0.7;
    armLMesh.castShadow = true;
    armLPivot.add(armLMesh);
    group.add(armLPivot);

    // 총 그룹 (OBJ 로드 완료 시 자동으로 메시 추가됨)
    const gunGroup = new THREE.Group();
    gunGroup.position.set(0.35, 1.22, 1.2);
    // OBJ가 이미 로드된 경우 즉시 클론, 아니면 나중에 createOrUpdateRemotePlayer에서 채움
    if (this._sharedGunObj) {
      const g = this._cloneGunForPlayer();
      gunGroup.add(g);
    }
    group.add(gunGroup);

    return { group, headPivot, legLPivot, legRPivot, armLPivot, armRPivot, gunGroup };
  }

  createOrUpdateRemotePlayer(pid, info, playerMeshMap) {
    if (!playerMeshMap[pid]) {
      const parts = this._buildPlayerGroup();
      this.scene.add(parts.group);
      playerMeshMap[pid] = parts;
    }

    const parts = playerMeshMap[pid];
    const { group, headPivot, legLPivot, legRPivot, armLPivot, armRPivot, gunGroup } = parts;

    const px = info.pos?.[0] ?? 0;
    const py = info.pos?.[1] ?? 0;
    const pz = info.pos?.[2] ?? 0;
    const yaw      = info.yaw       ?? 0;
    const pitch    = info.pitch     ?? 0;
    const moveTime = info.move_time ?? 0;
    const bobAmp   = info.bob_amp   ?? 0;
    const isSliding = !!info.is_sliding;
    const isAiming  = !!info.is_aiming;
    const recoil    = info.recoil   ?? 0;

    const slideOffset = isSliding ? -0.6 : 0;
    group.position.set(px, py + 0.4 + slideOffset, pz);
    group.rotation.y = -THREE.MathUtils.degToRad(yaw) - Math.PI / 2;

    // 머리 pitch (Python: extra_rot = RotX(pitch), pivot_y=-0.25)
    headPivot.rotation.x = THREE.MathUtils.degToRad(-pitch);

    // 다리 스윙 (Python: swing = sin(move_time*6)*20deg*bob_amp)
    const swing = isSliding ? 0 : Math.sin(moveTime * 6) * (20 * Math.PI/180) * bobAmp;
    legLPivot.rotation.x = isSliding ? (70*Math.PI/180) :  swing;
    legRPivot.rotation.x = isSliding ?-(70*Math.PI/180) : -swing;

    // 팔 (Python draw_asymmetric_arm)
    const ads = isAiming ? 1 : 0;
    // 오른팔 (side=1): z_rot=(-20+10*ads), x_rot=(65-15*ads)
    armRPivot.rotation.x = THREE.MathUtils.degToRad(65 - ads*15);
    armRPivot.rotation.z = THREE.MathUtils.degToRad(-20 + ads*10);
    // 왼팔 (side=-1): z_rot=(40-20*ads), x_rot=(45+10*ads)
    armLPivot.rotation.x = THREE.MathUtils.degToRad(45 + ads*10);
    armLPivot.rotation.z = THREE.MathUtils.degToRad( 40 - ads*20);

    // OBJ 로드 완료됐는데 아직 총이 없으면 추가
    if (this._sharedGunObj && gunGroup.children.length === 0) {
      gunGroup.add(this._cloneGunForPlayer());
    }

    // 총 반동
    gunGroup.rotation.x = recoil * -0.3;

    return parts.group;
  }

  removeRemotePlayer(pid, playerMeshMap) {
    if (playerMeshMap[pid]) {
      this.scene.remove(playerMeshMap[pid].group);
      delete playerMeshMap[pid];
    }
  }

  // 파티클
  spawnSmokeParticle(position) {
    const geo  = new THREE.BoxGeometry(0.05,0.05,0.05);
    const mat  = new THREE.MeshBasicMaterial({ color:0xaaaaaa, transparent:true, opacity:0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.particles.push({ mesh, life:1, baseSize:0.05,
      vel: new THREE.Vector3((Math.random()-0.5)*0.04, Math.random()*0.02+0.01, (Math.random()-0.5)*0.04) });
  }

  updateParticles(dt) {
    this.particles = this.particles.filter(p => {
      p.life -= dt * 1.2;
      if (p.life <= 0) { this.scene.remove(p.mesh); return false; }
      p.vel.y += 0.0005; p.vel.multiplyScalar(0.93);
      p.mesh.position.add(p.vel);
      p.mesh.scale.setScalar((p.baseSize * (1+(1-p.life)*4)) / p.baseSize);
      p.mesh.material.opacity = p.life > 0.2 ? p.life*0.6 : (p.life/0.2)*0.6;
      return true;
    });
  }

  render(camera) {
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.weaponScene, this.weaponCamera);
  }

  _onResize() {
    this.width = window.innerWidth; this.height = window.innerHeight;
    this.camera.aspect = this.width/this.height; this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = this.width/this.height; this.weaponCamera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }

  // ── OBJ 총 공유 로드 ──
  _loadSharedGun() {
    const loader = new OBJLoader();
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a, map: this.texWeapon });

    loader.load(
      './m4a1.obj',
      (obj) => {
        obj.traverse(child => {
          if (child.isMesh) { child.material = gunMat.clone(); child.castShadow = true; }
        });
        // 크기 정규화
        const box3 = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3(); box3.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        this._sharedGunScale = 0.45 / maxDim;
        box3.getCenter(this._sharedGunCenter);
        this._sharedGunObj = obj;
        console.log('[✅] renderer: m4a1.obj 공유 로드 완료');
      },
      null,
      (err) => console.warn('[⚠️] renderer: m4a1.obj 로드 실패', err)
    );
  }

  _cloneGunForPlayer() {
    const g = this._sharedGunObj.clone(true);
    const s = this._sharedGunScale;
    const c = this._sharedGunCenter;
    g.scale.setScalar(s);
    g.position.set(-c.x*s, -c.y*s, -c.z*s);
    g.rotation.set(0, Math.PI, 0);
    return g;
  }

  getBoxes()     { return this.boxMeshes; }
  getTexPlayer() { return this.texPlayer; }
  getTexWeapon() { return this.texWeapon; }
}
