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
          // ── 스파이어 기존 맵 ──
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

          // ════════════════════════════════════════════
          // ── 배틀필드 (스폰 뒤, z=-30 ~ -130 방향) ──
          // 점프력 고려: 최대 점프 높이 ≈2.4유닛, 플랫폼 간격 ≤2.0유닛
          // ════════════════════════════════════════════

          // 전장 바닥 (지면)
          [0,0,-70, 60,0.5,60, 0x3d4a2e,'checker'],

          // ── 참호 구역 (z=-25 ~ -50) ──
          // 좌측 벽 참호
          [-20,1,-30, 1,2,12, 0x4a5a35,'solid'],
          [-20,3,-30, 3,0.5,12, 0x3d4a2e,'solid'],  // 참호 지붕
          // 우측 벽 참호
          [20,1,-30, 1,2,12, 0x4a5a35,'solid'],
          [20,3,-30, 3,0.5,12, 0x3d4a2e,'solid'],
          // 중앙 엄폐물 (낮은 벽)
          [0,1,-28, 5,1,1, 0x5a6a45,'solid'],
          [0,1,-35, 4,1,1, 0x5a6a45,'solid'],
          [-10,1,-33, 2,1.5,1, 0x5a6a45,'solid'],
          [10,1,-33, 2,1.5,1, 0x5a6a45,'solid'],

          // ── 파괴된 건물 구역 (z=-50 ~ -80) ──
          // 좌측 파괴된 빌딩 - 1층
          [-22,1,-55, 6,2,5, 0x666655,'solid'],
          // 2층 (점프로 올라갈 수 있는 높이: +2.0)
          [-22,3,-55, 6,0.5,5, 0x555544,'solid'],
          // 3층 (점프로 올라갈 수 있는 높이: +2.0씩 누적)
          [-22,5.5,-55, 4,0.5,4, 0x444433,'solid'],
          // 좌측 잔해 발판
          [-14,1,-58, 2,1,2, 0x555544,'noise'],
          [-10,2,-58, 2,0.5,2, 0x555544,'noise'],  // 이 높이도 점프 가능 (+1)
          [-6,3,-58, 2,0.5,2, 0x555544,'noise'],   // (+1 누적)

          // 우측 파괴된 빌딩 - 1층
          [22,1,-55, 6,2,5, 0x666655,'solid'],
          // 2층
          [22,3,-55, 6,0.5,5, 0x555544,'solid'],
          // 우측 잔해 발판
          [14,1,-58, 2,1,2, 0x555544,'noise'],
          [10,2,-58, 2,0.5,2, 0x555544,'noise'],
          [6,3,-58, 2,0.5,2, 0x555544,'noise'],

          // ── 중앙 광장 / 거대 포대 (z=-70) ──
          [0,1,-68, 3,3,3, 0x7a5a3a,'solid'],    // 포대 받침대
          [0,4,-68, 4,0.5,4, 0x6a4a2a,'solid'],  // 포대 플랫폼 (높이3에서 점프로 도달 가능)
          [-8,1,-70, 4,1,3, 0x5a6a45,'solid'],   // 좌 장벽
          [8,1,-70, 4,1,3, 0x5a6a45,'solid'],    // 우 장벽

          // ── 고지 구역 (z=-90 ~ -120) ──
          // 좌측 언덕 (계단식, 점프로 오를 수 있는 2유닛 간격)
          [-25,1,-85, 8,0.5,8, 0x3d5a2e,'noise'],
          [-25,3,-95, 8,0.5,8, 0x3d5a2e,'noise'],  // 2유닛 높이차 (한 번 점프로 가능)
          [-25,5,-105, 8,0.5,8, 0x3d5a2e,'noise'],
          [-25,7,-115, 8,0.5,8, 0x2d4a1e,'noise'],
          // 좌측 저격 탑
          [-25,7,-115, 2,4,2, 0x333333,'solid'],
          [-25,11,-115, 4,0.5,4, 0x444444,'solid'],  // 저격 탑 꼭대기

          // 우측 언덕 (계단식)
          [25,1,-85, 8,0.5,8, 0x3d5a2e,'noise'],
          [25,3,-95, 8,0.5,8, 0x3d5a2e,'noise'],
          [25,5,-105, 8,0.5,8, 0x3d5a2e,'noise'],
          [25,7,-115, 8,0.5,8, 0x2d4a1e,'noise'],
          // 우측 저격 탑
          [25,7,-115, 2,4,2, 0x333333,'solid'],
          [25,11,-115, 4,0.5,4, 0x444444,'solid'],

          // 중앙 고지 (최고점 진지)
          [0,2,-100, 10,0.5,10, 0x2d4a1e,'checker'],
          [0,4,-110, 8,0.5,8, 0x2d4a1e,'checker'],   // 2유닛 차이 → 점프 가능
          [0,4,-110, 2,3,2, 0x222222,'solid'],        // 기관총 벙커
          [0,7,-110, 5,0.5,5, 0x333333,'solid'],      // 벙커 지붕

          // ── 보급 창고 (z=-55 좌우) - 크레이트 포인트 근처 ──
          [-30,1,-55, 4,2,6, 0x8a7755,'solid'],
          [30,1,-55, 4,2,6, 0x8a7755,'solid'],

          // ── 스폰 → 배틀필드 연결 브리지 ──
          // 스폰(z=0) 뒤쪽 진입 통로
          [0,1,-12, 5,0.5,8, 0x4d5540,'solid'],
          [-8,1,-18, 3,0.5,3, 0x4d5540,'solid'],
          [8,1,-18, 3,0.5,3, 0x4d5540,'solid'],
          [0,1,-22, 5,0.5,4, 0x4d5540,'solid'],
        ],
      },
      circuit: {
        name: 'NEON CIRCUIT',
        background: 0x101828,
        boxes: [
          ...base,
          // ── 개편된 네온 서킷 (점프력 기반 재설계) ──
          // 점프 최대 높이 ≈2.4유닛 → 플랫폼 높이차 ≤2.0유닛으로 설계

          // ── 구역 1: 시작 아레나 (z=20~50) ──
          [0,1,30, 20,0.5,14, 0x0d2233,'checker'],        // 메인 그라운드
          // 저지대 엄폐물 (높이 1.5~2, 점프 통과 가능)
          [-12,2,26, 2,1,2, 0x00ffe0,'solid'],
          [12,2,26, 2,1,2, 0x00ffe0,'solid'],
          [0,2,22, 3,1,1, 0x00ffe0,'solid'],
          [-8,2,38, 2,1,2, 0xff00aa,'solid'],
          [8,2,38, 2,1,2, 0xff00aa,'solid'],
          // 중간 플랫폼 (높이 +2.0 → 한 번 점프로 도달)
          [-18,3,35, 5,0.5,5, 0x00b3aa,'solid'],
          [18,3,35, 5,0.5,5, 0xffcc33,'solid'],
          // 상단 플랫폼 (높이 +2.0 추가 → 총 +4.0, 점프패드 필요)
          [-18,5,35, 3,0.5,3, 0x007799,'solid'],
          [18,5,35, 3,0.5,3, 0xcc9900,'solid'],

          // ── 구역 2: 고속 회랑 (z=50~85) ──
          // 메인 레인 (지면)
          [0,1,65, 12,0.5,18, 0x0d1a2d,'checker'],
          // 좌측 고가 레일 (높이 3.0, 점프패드로 올라가는 구조)
          [-16,3,55, 3,0.5,10, 0x0044cc,'solid'],
          [-16,3,75, 3,0.5,10, 0x0044cc,'solid'],
          // 우측 고가 레일
          [16,3,55, 3,0.5,10, 0xcc4400,'solid'],
          [16,3,75, 3,0.5,10, 0xcc4400,'solid'],
          // 연결 브리지 (높이 3.0 → 점프패드 필요)
          [0,3,65, 5,0.5,6, 0x334455,'solid'],
          // 중앙 가드레일 (낮은 벽, 엄폐용)
          [0,3.5,60, 6,0.5,1, 0x223344,'solid'],
          [0,3.5,70, 6,0.5,1, 0x223344,'solid'],
          // 점프 발판 (레일 올라가기 위한 중간 발판, +1.5)
          [-10,2.5,55, 3,0.5,3, 0x0022aa,'solid'],
          [10,2.5,55, 3,0.5,3, 0xaa2200,'solid'],
          [-10,2.5,75, 3,0.5,3, 0x0022aa,'solid'],
          [10,2.5,75, 3,0.5,3, 0xaa2200,'solid'],

          // ── 구역 3: 사이버 아레나 (z=85~120) ──
          [0,1,100, 20,0.5,18, 0x0d2233,'checker'],
          // 4코너 타워 (높이 2.0씩 올라가는 계단형)
          [-18,2,90, 4,0.5,4, 0xff66c4,'solid'],
          [-18,4,90, 3,0.5,3, 0xcc3399,'solid'],         // +2.0 → 점프로 도달
          [18,2,90, 4,0.5,4, 0xffcc33,'solid'],
          [18,4,90, 3,0.5,3, 0xcc9900,'solid'],
          [-18,2,110, 4,0.5,4, 0x00ffe0,'solid'],
          [-18,4,110, 3,0.5,3, 0x00b3aa,'solid'],
          [18,2,110, 4,0.5,4, 0xe63333,'solid'],
          [18,4,110, 3,0.5,3, 0xaa2222,'solid'],
          // 중앙 코어 탑
          [0,1,100, 3,4,3, 0x9933dd,'noise'],             // 코어 기둥
          [0,5,100, 5,0.5,5, 0xcc66ff,'solid'],           // 코어 꼭대기 (높이5, 점프패드로)
          // 중간 높이 발판들 (높이 3.0, 점프로 오를 수 있는 2유닛 계단)
          [-8,3,95, 3,0.5,3, 0x334466,'solid'],
          [8,3,95, 3,0.5,3, 0x334466,'solid'],
          [-8,3,105, 3,0.5,3, 0x334466,'solid'],
          [8,3,105, 3,0.5,3, 0x334466,'solid'],

          // ── 구역 4: 정상 포탑 (z=120~155) ──
          [0,1,135, 16,0.5,16, 0x0d1a2d,'checker'],
          // 계단형 플랫폼 (2유닛 간격으로 올라가도록)
          [-10,2,125, 4,0.5,4, 0x0044cc,'solid'],
          [-6,4,128, 4,0.5,4, 0x0044cc,'solid'],          // +2
          [-2,6,131, 4,0.5,4, 0x0044cc,'solid'],          // +2
          [2,8,134, 4,0.5,4, 0xcc4400,'solid'],           // +2
          [6,10,137, 4,0.5,4, 0xcc4400,'solid'],          // +2 (점프패드로)
          // 최상단 전투 구역
          [0,12,150, 14,0.5,10, 0xf2f2ff,'checker'],
          // 좌우 기둥
          [-12,17,145, 2,10,2, 0xccccdd,'stripe'],
          [12,17,145, 2,10,2, 0xccccdd,'stripe'],
          [0,22,145, 14,0.5,4, 0xccccdd,'solid'],
          // 최상단 오브젝트
          [0,13,150, 3,2,3, 0x9933dd,'noise'],
        ],
      },
      crater: {
        name: 'CRATER RUN',
        background: 0x5a4030,
        boxes: [
          ...base,
          // ── 개편된 크레이터 런 (점프력 기반 재설계) ──
          // 최대 점프 높이 ≈2.4유닛 → 플랫폼 높이차 ≤2.0유닛

          // ── 구역 1: 충돌 지점 (z=20~45) ──
          // 운석 충돌로 파괴된 지형
          [0,0.5,30, 18,0.5,12, 0x6a4a30,'noise'],        // 메인 평지
          // 분화구 테두리 잔해 (높이 2.0, 한 번 점프로 올라가기 가능)
          [-14,2,28, 3,1,4, 0x7a5a40,'noise'],
          [14,2,28, 3,1,4, 0x7a5a40,'noise'],
          [-14,2,38, 3,1,4, 0x7a5a40,'noise'],
          [14,2,38, 3,1,4, 0x7a5a40,'noise'],
          // 중앙 거대 운석 잔해 (낮은 엄폐물)
          [-4,1.5,30, 2,1,2, 0x5a4030,'noise'],
          [4,1.5,30, 2,1,2, 0x5a4030,'noise'],
          [0,2,35, 3,1.5,2, 0x4a3020,'noise'],

          // ── 구역 2: 용암 지형 (z=45~75) ──
          // 점프로 건너야 하는 좁은 발판들 (높이 1.5~3.0)
          [-8,1.5,50, 3,0.5,3, 0x8a5a30,'noise'],
          [0,2,52, 3,0.5,3, 0x8a5a30,'noise'],           // +0.5 높이
          [8,1.5,54, 3,0.5,3, 0x8a5a30,'noise'],
          [-6,2.5,58, 3,0.5,3, 0x7a4a20,'noise'],        // +1.0
          [6,2.5,60, 3,0.5,3, 0x7a4a20,'noise'],
          [0,3,63, 4,0.5,4, 0x6a3a10,'noise'],           // +1.5 (점프로 도달)
          // 좌우 협곡 벽 (발판 역할)
          [-20,1,55, 2,4,14, 0x4a3020,'noise'],          // 좌 절벽
          [-18,5,55, 4,0.5,4, 0x5a3a20,'noise'],         // 절벽 꼭대기 발판 (+4 - 직접 점프 불가, 협곡 벽 경유)
          [-16,3,55, 3,0.5,3, 0x5a3a20,'noise'],         // 중간 단계 (+2)
          [20,1,55, 2,4,14, 0x4a3020,'noise'],           // 우 절벽
          [18,5,55, 4,0.5,4, 0x5a3a20,'noise'],
          [16,3,55, 3,0.5,3, 0x5a3a20,'noise'],

          // ── 구역 3: 화산 평원 (z=75~105) ──
          [0,1,88, 14,0.5,16, 0x5a3020,'checker'],       // 넓은 발판
          // 좌측 화산 분출구 (계단식)
          [-18,2,80, 5,0.5,5, 0x8a4a20,'noise'],
          [-18,4,85, 5,0.5,5, 0x6a3a10,'noise'],         // +2.0 → 점프 가능
          [-18,6,90, 5,0.5,5, 0x4a2a00,'noise'],         // +2.0 → 점프 가능
          // 우측 화산 분출구 (계단식)
          [18,2,80, 5,0.5,5, 0x8a4a20,'noise'],
          [18,4,85, 5,0.5,5, 0x6a3a10,'noise'],
          [18,6,90, 5,0.5,5, 0x4a2a00,'noise'],
          // 중앙 용암 교각 (연결 발판)
          [0,3,78, 3,0.5,3, 0x7a3a10,'solid'],           // 교각 1 (+2.0)
          [0,4,83, 3,0.5,3, 0x6a2a00,'solid'],           // 교각 2 (+1.0)
          [0,4,90, 3,0.5,3, 0x6a2a00,'solid'],           // 교각 3
          [0,4,97, 3,0.5,3, 0x6a2a00,'solid'],           // 교각 4
          // 엄폐물
          [-6,1.5,88, 2,1,2, 0x4a3020,'solid'],
          [6,1.5,88, 2,1,2, 0x4a3020,'solid'],
          [-6,1.5,98, 2,1,2, 0x4a3020,'solid'],
          [6,1.5,98, 2,1,2, 0x4a3020,'solid'],

          // ── 구역 4: 화산 정상 (z=105~145) ──
          // 점프력 고려한 지그재그 오름 경로 (2유닛 간격)
          [-14,2,108, 6,0.5,5, 0xe69a1a,'noise'],
          [-8,4,114, 6,0.5,5, 0xd08010,'noise'],         // +2.0
          [0,6,120, 6,0.5,5, 0xb86000,'noise'],          // +2.0
          [8,8,126, 6,0.5,5, 0xa04800,'noise'],          // +2.0
          [14,10,132, 6,0.5,5, 0x883000,'noise'],        // +2.0 (점프패드로)
          // 최정상 분화구 림
          [0,12,142, 18,0.5,16, 0xf2d0a0,'checker'],
          // 기둥들
          [-12,14,138, 2,5,2, 0x333333,'solid'],
          [12,14,138, 2,5,2, 0x333333,'solid'],
          [-12,14,150, 2,5,2, 0x333333,'solid'],
          [12,14,150, 2,5,2, 0x333333,'solid'],
          [0,17,142, 36,0.5,4, 0xcccccc,'solid'],        // 최상단 연결
          // 정상 오브젝트
          [0,13,142, 3,2,3, 0x9933dd,'noise'],
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
      // Remote grenade meshes: pid → Map of grenade meshes
      parts._remoteGrenades = [];
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

    // ── 원격 수류탄 렌더링 ──
    const remoteGrenadeData = Array.isArray(info.grenades) ? info.grenades : [];
    // 기존 수류탄 메시 수 조정
    while (parts._remoteGrenades.length > remoteGrenadeData.length) {
      const old = parts._remoteGrenades.pop();
      this.scene.remove(old);
    }
    while (parts._remoteGrenades.length < remoteGrenadeData.length) {
      const geo  = new THREE.SphereGeometry(0.08, 6, 6);
      const mat  = new THREE.MeshLambertMaterial({ color: 0x2d4a1e });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      this.scene.add(mesh);
      parts._remoteGrenades.push(mesh);
    }
    for (let i = 0; i < remoteGrenadeData.length; i++) {
      const g = remoteGrenadeData[i];
      parts._remoteGrenades[i].position.set(g.px, g.py, g.pz);
    }

    // ── 원격 로켓 렌더링 ──
    parts._remoteRockets = parts._remoteRockets || [];
    const remoteRocketData = Array.isArray(info.rockets) ? info.rockets : [];
    while (parts._remoteRockets.length > remoteRocketData.length) {
      const old = parts._remoteRockets.pop();
      this.scene.remove(old);
    }
    while (parts._remoteRockets.length < remoteRocketData.length) {
      const rGroup = new THREE.Group();
      const bodyGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.55, 8);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.6, metalness: 0.4 });
      const body    = new THREE.Mesh(bodyGeo, bodyMat);
      body.rotation.x = Math.PI / 2;
      rGroup.add(body);
      const noseGeo = new THREE.ConeGeometry(0.045, 0.18, 8);
      const noseMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.8 });
      const nose    = new THREE.Mesh(noseGeo, noseMat);
      nose.rotation.x = Math.PI / 2;
      nose.position.z = -0.37;
      rGroup.add(nose);
      const exhaustGeo = new THREE.SphereGeometry(0.06, 6, 6);
      const exhaustMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
      const exhaust    = new THREE.Mesh(exhaustGeo, exhaustMat);
      exhaust.position.z = 0.30;
      rGroup.add(exhaust);
      rGroup._exhaust = exhaust;
      this.scene.add(rGroup);
      parts._remoteRockets.push(rGroup);
    }
    for (let i = 0; i < remoteRocketData.length; i++) {
      const r = remoteRocketData[i];
      const rGroup = parts._remoteRockets[i];
      rGroup.position.set(r.px, r.py, r.pz);
      const vel = new THREE.Vector3(r.vx, r.vy, r.vz);
      if (vel.lengthSq() > 0.0001) {
        const target = rGroup.position.clone().add(vel);
        rGroup.lookAt(target);
        rGroup.rotateY(Math.PI);
      }
      if (rGroup._exhaust) {
        rGroup._exhaust.material.opacity = 0.7 + Math.random() * 0.3;
      }
    }

    return parts.group;
  }

  removeRemotePlayer(pid, playerMeshMap) {
    if (playerMeshMap[pid]) {
      // 원격 수류탄 메시 정리
      if (playerMeshMap[pid]._remoteGrenades) {
        for (const g of playerMeshMap[pid]._remoteGrenades) this.scene.remove(g);
      }
      // 원격 로켓 메시 정리
      if (playerMeshMap[pid]._remoteRockets) {
        for (const r of playerMeshMap[pid]._remoteRockets) this.scene.remove(r);
      }
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

  // ── RPG 로켓 폭발 이펙트 (수류탄과 유사하지만 더 크고 강렬) ──
  spawnRocketExplosion(pos) {

    // 플래시 (더 큼)
    const flashGeo = new THREE.SphereGeometry(0.5, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 1 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos);
    this.scene.add(flash);
    this.particles.push({ mesh: flash, life: 1, maxLife: 1, type: 'rpg_flash', vel: null, baseSize: 0.5 });

    // 화염구 파티클 (많고 큼)
    for (let i = 0; i < 20; i++) {
      const size = 0.20 + Math.random() * 0.50;
      const geo  = new THREE.SphereGeometry(size, 6, 6);
      const mat  = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.04 + Math.random() * 0.06, 1, 0.45 + Math.random() * 0.25),
        transparent: true, opacity: 0.95
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.35,
        Math.random() * 0.30 + 0.08,
        (Math.random() - 0.5) * 0.35
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, life: 1, maxLife: 1.2, type: 'rpg_fire', scale: size, baseSize: size });
    }

    // 연기 (크고 오래)
    for (let i = 0; i < 14; i++) {
      const geo = new THREE.SphereGeometry(0.30 + Math.random() * 0.30, 5, 5);
      const mat = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.65 });
      const mesh = new THREE.Mesh(geo, mat);
      const spread = new THREE.Vector3(Math.random()-0.5, Math.random(), Math.random()-0.5).normalize();
      mesh.position.copy(pos).addScaledVector(spread, Math.random() * 2.2);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.05,
        0.03 + Math.random() * 0.04,
        (Math.random() - 0.5) * 0.05
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, life: 1, maxLife: 3.5, type: 'rpg_smoke', scale: 0.30 + Math.random() * 0.30, baseSize: 1 });
    }

    // 파편 (작고 빠름)
    for (let i = 0; i < 24; i++) {
      const geo  = new THREE.BoxGeometry(0.05, 0.05, 0.12);
      const mat  = new THREE.MeshBasicMaterial({ color: 0x666666 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.55,
        Math.random() * 0.50 + 0.15,
        (Math.random() - 0.5) * 0.55
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, life: 1, maxLife: 0.9, type: 'rpg_debris', baseSize: 1 });
    }

    // 충격파 링 (두 개)
    for (let ri = 0; ri < 2; ri++) {
      const ringGeo = new THREE.TorusGeometry(0.15, 0.06, 6, 20);
      const ringMat = new THREE.MeshBasicMaterial({ color: ri === 0 ? 0xff8800 : 0xffdd00, transparent: true, opacity: 0.9 });
      const ring    = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
      this.particles.push({ mesh: ring, life: 1, maxLife: 0.55 + ri * 0.15, type: 'rpg_ring', baseSize: 1 });
    }
  }

  updateParticles(dt) {
    this.particles = this.particles.filter(p => {
      // rpg 파티클은 maxLife 기반으로 수명 감소 (수류탄과 동일 패턴)
      if (p.maxLife) p.life -= dt / p.maxLife;
      else           p.life -= dt * 1.2;
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
      // ── RPG 폭발 파티클 ──
      if (p.type === 'rpg_flash') {
        const s = 1 + (1 - p.life) * 12;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = p.life;
        return true;
      }
      if (p.type === 'rpg_fire') {
        p.vel.y -= 0.004;
        p.mesh.position.addScaledVector(p.vel, 60 * dt);
        p.mesh.scale.setScalar(p.life * 1.8);
        p.mesh.material.opacity = p.life * 0.92;
        p.mesh.material.color.setHSL(0.05 * p.life, 1, 0.5);
        return true;
      }
      if (p.type === 'rpg_smoke') {
        p.mesh.position.addScaledVector(p.vel, 60 * dt);
        p.vel.y += 0.001;
        const s = p.scale * (1 + (1 - p.life) * 4);
        p.mesh.scale.setScalar(s / p.scale);
        p.mesh.material.opacity = p.life * 0.52;
        return true;
      }
      if (p.type === 'rpg_debris') {
        p.vel.y -= 0.018;
        p.mesh.position.addScaledVector(p.vel, 60 * dt);
        p.mesh.rotation.x += 0.28;
        p.mesh.rotation.z += 0.20;
        p.mesh.material.opacity = p.life;
        return true;
      }
      if (p.type === 'rpg_ring') {
        const s = 1 + (1 - p.life) * 18;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = p.life * 0.75;
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
