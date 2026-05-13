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
    this.weaponScene.add(this.weaponCamera);

    // PBR lighting for MeshStandardMaterial gun
    this.weaponScene.add(new THREE.AmbientLight(0xffffff, 1.2));

    // Key light: top-right-front → main highlight on gun body
    const wKey = new THREE.DirectionalLight(0xffeedd, 3.0);
    wKey.position.set(2, 3, 2);
    this.weaponScene.add(wKey);

    // Fill light: left → soften shadows
    const wFill = new THREE.DirectionalLight(0x8899cc, 1.2);
    wFill.position.set(-2, 1, 1);
    this.weaponScene.add(wFill);

    // Rim light: back-top → edge highlight for metal feel
    const wRim = new THREE.DirectionalLight(0xaaccff, 0.8);
    wRim.position.set(0, 2, -3);
    this.weaponScene.add(wRim);

    this._buildTextures();
    this._setupLights();
    this.mapId = localStorage.getItem('vp_map_id') || 'spire';
    this.jumpPads = [];
    this.airPoints = [];
    this.worldGroups = [];
    this._buildWorld(this.mapId);
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

  _mapData(mapId) {
    const base = [
      [0,-30,80,   400,1,400,   0x0d0d15,'checker'],
      [0,0,0,      15,1,15,     0xccccda,'checker'],
      [-14,1.5,-14,0.5,1,0.5,  0xb39933,'stripe'],
      [14,1.5,-14, 0.5,1,0.5,  0xb39933,'stripe'],
      [-14,1.5,14, 0.5,1,0.5,  0xb39933,'stripe'],
      [14,1.5,14,  0.5,1,0.5,  0xb39933,'stripe'],
    ];
    const maps = {
      spire: {
        name: 'SKY SPIRE',
        background: 0x6699cc,
        boxes: [
          ...base,
          [0,1,12,4,0.5,4,0x7fa0b3,'solid'], [0,2,15,4,0.5,4,0x7fa0b3,'solid'], [0,3,18,4,0.5,4,0x7fa0b3,'solid'],
          [0,4,21,4,0.5,4,0x7fa0b3,'solid'], [0,5,35,15,1,15,0x4d5966,'checker'], [-6,6.5,37,2,1,2,0x666666,'stripe'],
          [8,6.8,40,1.5,1.3,1.5,0x666666,'stripe'], [-4,6.2,45,3,0.7,1.5,0x666666,'stripe'], [5,6.5,47,1,1,3,0x666666,'stripe'],
          [-13,8,42,1,3,1,0x333333,'solid'], [-13,11.5,42,1.5,0.5,1.5,0xccb833,'solid'], [13,8,42,1,3,1,0x333333,'solid'],
          [13,11.5,42,1.5,0.5,1.5,0xccb833,'solid'], [0,6,54,3,0.2,3,0xe69a1a,'solid'], [-4,7,60,3,0.2,3,0xe69a1a,'solid'],
          [-8,8,66,3,0.2,3,0xe69a1a,'solid'], [-4,9,72,3,0.2,3,0xe69a1a,'solid'], [0,10,78,3,0.2,3,0xe69a1a,'solid'],
          [4,11,84,3,0.2,3,0xe69a1a,'solid'], [0,12,90,3,0.2,3,0xe69a1a,'solid'], [0,13,99,10,0.5,10,0xccd9e6,'checker'],
          [-8,14.5,99,1,1.5,1,0x999999,'solid'], [8,14.5,99,1,1.5,1,0x999999,'solid'], [0,16.5,99,9,0.5,1,0x999999,'solid'],
          [0,15,99,2,2,2,0xffcc33,'noise'], [0,14,109,4,0.5,4,0x80b3e6,'solid'], [0,15,115,3,0.5,3,0x80b3e6,'solid'],
          [0,16,121,3,0.5,3,0x80b3e6,'solid'], [-5,17,124,3,0.2,3,0xe63333,'solid'], [-11,18,126,3,0.2,3,0xe63333,'solid'],
          [-14,19,128,3,0.2,3,0xe63333,'solid'], [-11,20,130,3,0.2,3,0xe63333,'solid'], [-5,21,132,3,0.2,3,0xe63333,'solid'],
          [0,22,136,3,0.2,3,0xe63333,'solid'], [0,23,162,25,1,25,0xf2f2ff,'checker'], [-15,27.5,152,2,10,2,0xccccdd,'stripe'],
          [15,27.5,152,2,10,2,0xccccdd,'stripe'], [0,32,152,32,1,4,0xccccdd,'solid'], [0,25,152,3,4,3,0x9933dd,'noise'],
          [0,29,152,1.5,1.5,1.5,0xe6ccff,'noise'],
        ],
      },
      circuit: {
        name: 'NEON CIRCUIT',
        background: 0x253850,
        boxes: [
          ...base,
          [0,1,36,28,1,12,0x1d4254,'checker'], [-22,4,58,7,0.5,7,0x00b3aa,'solid'], [22,4,58,7,0.5,7,0xffcc33,'solid'],
          [0,7,78,18,0.5,8,0x334455,'checker'], [-18,11,100,8,0.5,8,0xff66c4,'solid'], [18,11,100,8,0.5,8,0xe63333,'solid'],
          [0,15,126,22,0.5,10,0x80b3e6,'checker'], [0,18,152,12,0.5,12,0xf2f2ff,'solid'],
          [-26,8,80,2,8,2,0x111111,'solid'], [26,8,80,2,8,2,0x111111,'solid'], [0,21,152,3,4,3,0x9933dd,'noise'],
        ],
      },
      crater: {
        name: 'CRATER RUN',
        background: 0x735b4a,
        boxes: [
          ...base,
          [0,1,34,20,1,18,0x8a6a50,'noise'], [-18,4,58,7,0.6,7,0xb46f3c,'noise'], [18,5,62,8,0.6,8,0xb46f3c,'noise'],
          [0,8,84,13,0.6,13,0x5b4638,'checker'], [-20,12,108,9,0.6,9,0xe69a1a,'solid'], [20,14,114,9,0.6,9,0xe63333,'solid'],
          [0,18,140,18,0.8,18,0xf2f2ff,'checker'], [-10,20,148,2,5,2,0x333333,'solid'], [10,20,148,2,5,2,0x333333,'solid'],
        ],
      },
    };
    return maps[mapId] || maps.spire;
  }

  _buildWorld(mapId = 'spire') {
    for (const group of this.worldGroups || []) this.scene.remove(group);
    this.boxMeshes = [];
    this.jumpPads = [];
    this.airPoints = [];
    this.worldGroups = [];
    const T = { checker:this.texChecker, stripe:this.texStripe, noise:this.texNoise, solid:this.texSolid };
    const map = this._mapData(mapId);
    this.mapId = mapId;
    localStorage.setItem('vp_map_id', mapId);
    this.scene.background = new THREE.Color(map.background);
    this.scene.fog.color.set(map.background);

    map.boxes.forEach(([x,y,z, sx,sy,sz, hex, tk]) => {
      const geo  = new THREE.BoxGeometry(sx*2, sy*2, sz*2);
      const mat  = new THREE.MeshLambertMaterial({ color: hex, map: T[tk] });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.worldGroups.push(mesh);
      this.boxMeshes.push({ pos:[x,y,z], size:[sx,sy,sz] });
    });
    this._buildBoosters();
  }

  setMap(mapId) {
    this._buildWorld(mapId);
  }

  _buildBoosters() {
    const mkPad = (x, y, z, color, power, speed = 0.02) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.35, 1.35, 0.18, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 })
      );
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.worldGroups.push(mesh);
      this.jumpPads.push({ pos: new THREE.Vector3(x, y, z), radius: 1.65, power, speed, color });
    };
    const mkPoint = (x, y, z, color, power, speed = 0.016, type = 'jump') => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 16, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: type === 'drop' ? 0.55 : 0.72 })
      );
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.worldGroups.push(mesh);
      this.airPoints.push({ pos: new THREE.Vector3(x, y, z), radius: 1.35, power, speed, color, type, mesh });
    };
    mkPad(-8, 1.15, 10, 0xff66c4, 0.38, 0.016);
    mkPad(8, 1.15, 10, 0xffcc33, 0.58, 0.022);
    mkPad(0, 6.15, 48, 0xe63333, 0.82, 0.035);
    mkPoint(-7, 9, 64, 0xff66c4, 0.34, 0.014);
    mkPoint(8, 13, 92, 0xffcc33, 0.56, 0.02);
    mkPoint(-10, 18, 122, 0xe63333, 0.78, 0.032);
    mkPoint(10, 22, 136, 0x050505, -0.65, 0, 'drop');
  }

  getJumpPadAt(pos) {
    return this.jumpPads.find(p => Math.abs(pos.y - p.pos.y) < 1.2 && pos.distanceTo(p.pos) < p.radius);
  }

  getAirPointAt(pos) {
    return this.airPoints.find(p => pos.distanceTo(p.pos) < p.radius);
  }

  spawnPadBurst(position, color = 0xff66c4) {
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.045, 0.045),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
      );
      mesh.position.copy(position);
      const vel = new THREE.Vector3((Math.random()-0.5)*0.16, Math.random()*0.18+0.03, (Math.random()-0.5)*0.16);
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, life: 0.5, type: 'spark', baseSize: 1 });
    }
  }

  // ── 원격 플레이어 풀바디 (Python draw_player_full 직역) ──
  _buildPlayerGroup() {
    const group = new THREE.Group();
    // 기본 머티리얼 (픽셀 텍스처 적용 전 폴백)
    const pMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: this.texPlayer });
    const box  = (sx,sy,sz) => new THREE.BoxGeometry(sx*2, sy*2, sz*2);

    // 몸통
    const body = new THREE.Mesh(box(0.4,0.6,0.25), pMat.clone());
    body.position.y = 1.0; body.castShadow = true;
    group.add(body);

    // 머리
    const headPivot = new THREE.Group();
    headPivot.position.y = 1.7;
    const head = new THREE.Mesh(box(0.25,0.25,0.25), pMat.clone());
    head.castShadow = true; headPivot.add(head);
    group.add(headPivot);

    // 왼다리
    const legLPivot = new THREE.Group();
    legLPivot.position.set(-0.25, 1.0, 0);
    const legLMesh = new THREE.Mesh(box(0.2,0.7,0.2), pMat.clone());
    legLMesh.position.y = -0.7; legLMesh.castShadow = true; legLPivot.add(legLMesh);
    group.add(legLPivot);

    // 오른다리
    const legRPivot = new THREE.Group();
    legRPivot.position.set(0.25, 1.0, 0);
    const legRMesh = new THREE.Mesh(box(0.2,0.7,0.2), pMat.clone());
    legRMesh.position.y = -0.7; legRMesh.castShadow = true; legRPivot.add(legRMesh);
    group.add(legRPivot);

    // 오른팔
    const armRPivot = new THREE.Group();
    armRPivot.position.set(0.45, 1.4, 0.05);
    const armRMesh = new THREE.Mesh(box(0.15,0.6,0.15), pMat.clone());
    armRMesh.position.y = -0.6; armRMesh.castShadow = true; armRPivot.add(armRMesh);
    group.add(armRPivot);

    // 왼팔
    const armLPivot = new THREE.Group();
    armLPivot.position.set(-0.45, 1.4, 0.05);
    const armLMesh = new THREE.Mesh(box(0.15,0.7,0.15), pMat.clone());
    armLMesh.position.y = -0.7; armLMesh.castShadow = true; armLPivot.add(armLMesh);
    group.add(armLPivot);

    // 총 그룹
    const gunGroup = new THREE.Group();
    gunGroup.position.set(0.35, 1.22, 1.2);
    if (this._sharedGunObj) gunGroup.add(this._cloneGunForPlayer());
    group.add(gunGroup);

    // 픽셀 텍스처 적용 대상 메시들 (나중에 applyPixels로 업데이트)
    const bodyMeshes = [body, head, legLMesh, legRMesh, armRMesh, armLMesh];

    return { group, headPivot, legLPivot, legRPivot, armLPivot, armRPivot,
             gunGroup, nameplate: null, bodyMeshes, _lastPixelKey: null };
  }

  // ── 픽셀 영역 평균색 계산 ──
  _avgColor(pixels, x0, x1, y0, y1) {
    let r=0,g=0,b=0,n=0;
    for (let y=y0; y<=y1; y++) {
      for (let x=x0; x<=x1; x++) {
        const col = pixels[y]?.[x];
        if (col && col !== 'null' && col.startsWith('#')) {
          r += parseInt(col.slice(1,3),16);
          g += parseInt(col.slice(3,5),16);
          b += parseInt(col.slice(5,7),16);
          n++;
        }
      }
    }
    if (n===0) return '#888888';
    return `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`;
  }

  // ── 픽셀 배열 → THREE.Texture ──
  _pixelsToTexture(pixels) {
    if (!pixels || !Array.isArray(pixels)) return this.texPlayer;
    const size = 16;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const col = pixels[y]?.[x];
        const i = (y * size + x) * 4;
        if (col && col !== 'null') {
          const r = parseInt(col.slice(1,3),16);
          const g = parseInt(col.slice(3,5),16);
          const b = parseInt(col.slice(5,7),16);
          data[i]=r; data[i+1]=g; data[i+2]=b; data[i+3]=255;
        } else {
          data[i]=data[i+1]=data[i+2]=data[i+3]=0; // 투명
        }
      }
    }
    const tex = new THREE.DataTexture(data, size, size);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter  = THREE.NearestFilter;
    tex.minFilter  = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // ── 이름표 스프라이트 생성 ──
  _makeNameplate(nickname) {
    const canvas = document.createElement('canvas');
    canvas.width  = 256;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');

    // 배경
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.roundRect(0, 0, 256, 48, 8);
    ctx.fill();

    // 테두리
    ctx.strokeStyle = 'rgba(0,255,224,0.6)';
    ctx.lineWidth = 1.5;
    ctx.roundRect(1, 1, 254, 46, 8);
    ctx.stroke();

    // 텍스트
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nickname, 128, 24);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;

    const mat      = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite   = new THREE.Sprite(mat);
    sprite.scale.set(1.6, 0.3, 1);
    sprite.position.y = 2.5; // 머리 위
    sprite.renderOrder = 999;
    return sprite;
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

    // ── 픽셀 → 부위별 평균색 단색 적용 ──
    const pixels = info.pixels;
    const pixelKey = pixels ? JSON.stringify(pixels) : null;
    if (pixelKey && pixelKey !== parts._lastPixelKey) {
      const [body, head, legL, legR, armR, armL] = parts.bodyMeshes;
      const setColor = (mesh, col) => {
        mesh.material.map = null;
        mesh.material.color.set(col);
        mesh.material.needsUpdate = true;
      };
      setColor(head, this._avgColor(pixels, 4, 11,  0,  4));
      setColor(body, this._avgColor(pixels, 3, 12,  5, 10));
      setColor(legL, this._avgColor(pixels, 4,  7, 11, 15));
      setColor(legR, this._avgColor(pixels, 8, 11, 11, 15));
      setColor(armR, this._avgColor(pixels,13, 15,  5,  9));
      setColor(armL, this._avgColor(pixels, 0,  2,  5,  9));
      parts._lastPixelKey = pixelKey;
    }

    // 이름표 생성/갱신
    const nickname = info.nickname || pid.slice(-6);
    if (!parts.nameplate || parts._lastNick !== nickname) {
      if (parts.nameplate) group.remove(parts.nameplate);
      parts.nameplate  = this._makeNameplate(nickname);
      parts._lastNick  = nickname;
      group.add(parts.nameplate);
    }

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

  spawnMuzzleFlash(position, front, strong = false) {
    const group = new THREE.Group();
    group.position.copy(position).addScaledVector(front, 0.7);
    const flashMat = new THREE.MeshBasicMaterial({
      color: strong ? 0xfff1a8 : 0xffd25a,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(strong ? 0.16 : 0.1, 8, 8), flashMat);
    group.add(flash);
    const streak = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, strong ? 0.07 : 0.045, strong ? 1.6 : 0.75, 8),
      flashMat.clone()
    );
    streak.rotation.z = Math.PI / 2;
    group.add(streak);
    group.lookAt(position.clone().add(front));
    this.scene.add(group);
    this.particles.push({ mesh: group, life: strong ? 0.16 : 0.1, type: 'muzzle', baseSize: 1 });
  }

  spawnBulletImpact(position, headshot = false) {
    const color = headshot ? 0xff3030 : 0xfff2c0;
    for (let i = 0; i < (headshot ? 16 : 9); i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.035, 0.08),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
      );
      mesh.position.copy(position);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.22,
        Math.random() * 0.16 + 0.03,
        (Math.random() - 0.5) * 0.22
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, life: 0.55, type: 'spark', vel, baseSize: 1 });
    }
  }

  updateParticles(dt) {
    this.particles = this.particles.filter(p => {
      p.life -= dt * 1.2;
      if (p.life <= 0) { this.scene.remove(p.mesh); return false; }
      if (p.type === 'muzzle') {
        const s = Math.max(0.2, p.life * 8);
        p.mesh.scale.setScalar(s);
        p.mesh.traverse(child => {
          if (child.material) child.material.opacity = Math.min(1, p.life * 8);
        });
        return true;
      }
      if (p.type === 'spark') {
        p.vel.y -= 0.01;
        p.mesh.position.add(p.vel);
        p.mesh.rotation.x += 0.24;
        p.mesh.rotation.z += 0.18;
        p.mesh.material.opacity = Math.max(0, p.life * 1.8);
        return true;
      }
      p.vel.y += 0.0005; p.vel.multiplyScalar(0.93);
      p.mesh.position.add(p.vel);
      p.mesh.scale.setScalar((p.baseSize * (1+(1-p.life)*4)) / p.baseSize);
      p.mesh.material.opacity = p.life > 0.2 ? p.life*0.6 : (p.life/0.2)*0.6;
      return true;
    });
  }

  render(camera) {
    // weaponCamera stays at world origin — weapons are in its local space.
    // Only copy rotation so the gun follows the view direction.
    this.weaponCamera.position.set(0, 0, 0);
    this.weaponCamera.quaternion.copy(camera.quaternion);
    this.weaponCamera.updateMatrixWorld();

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
