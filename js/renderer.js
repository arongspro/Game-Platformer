// renderer.js - Three.js 씬, 조명, 맵, 원격 플레이어 풀바디
// ── v2: 고성능 PBR 쉐이더 + 고품질 프로시저럴 텍스처 ──

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { WEAPON_CATALOG } from './weapons.js';

// ════════════════════════════════════════════════════════════════
// ── 고성능 커스텀 쉐이더 정의 ──
// ════════════════════════════════════════════════════════════════

// PBR 박스 버텍스 쉐이더 (노멀맵 + AO + 그림자 좌표 지원)
const BOX_VERT = /* glsl */`
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewPos;
  varying vec4 vFragPosLightSpace;

  uniform mat4 uLightSpaceMatrix;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal   = normalize(normalMatrix * normal);
    vUv       = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos   = -mvPos.xyz;
    vFragPosLightSpace = uLightSpaceMatrix * worldPos;
    gl_Position = projectionMatrix * mvPos;
  }
`;

// PBR 박스 프래그먼트 쉐이더 (빛, PCF 그림자, 반사, AO)
const BOX_FRAG = /* glsl */`
  precision highp float;

  uniform vec3  uBaseColor;
  uniform float uRoughness;
  uniform float uMetalness;
  uniform float uTileScale;
  uniform int   uPattern;
  uniform float uTime;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform vec3  uFillColor;
  uniform float uFillIntensity;
  uniform vec3  uAmbientColor;
  uniform float uAmbientIntensity;
  uniform sampler2D uShadowMap;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewPos;
  varying vec4 vFragPosLightSpace;

  // ── 해시 함수 (노이즈용) ──
  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float hash3(vec3 p) {
    p = fract(p * vec3(127.1, 311.7, 74.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y + p.y * p.z);
  }

  // ── Value Noise (2D) ──
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i + vec2(0.0, 0.0));
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // ── FBM (Fractal Brownian Motion) - 자연스러운 질감 ──
  float fbm(vec2 p) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
      val += amp * valueNoise(p * freq);
      amp  *= 0.5;
      freq *= 2.1;
    }
    return val;
  }

  // ── 프로시저럴 노멀맵 계산 ──
  vec3 proceduralNormal(vec2 uv, float strength) {
    float eps = 0.01;
    float h0 = fbm(uv);
    float hx = fbm(uv + vec2(eps, 0.0));
    float hy = fbm(uv + vec2(0.0, eps));
    vec3 n = normalize(vec3((h0 - hx) / eps * strength,
                            (h0 - hy) / eps * strength,
                            1.0));
    return n;
  }

  // ── 패턴별 베이스 컬러 + 러프니스 계산 ──
  vec4 getPatternAlbedoRoughness(vec2 uv) {
    float rough = uRoughness;
    vec3  col   = uBaseColor;

    if (uPattern == 0) {
      // Checker - 콘크리트 타일
      vec2 c = floor(uv * uTileScale);
      float check = mod(c.x + c.y, 2.0);
      float grout = smoothstep(0.45, 0.50, abs(fract(uv.x * uTileScale) - 0.5)) +
                    smoothstep(0.45, 0.50, abs(fract(uv.y * uTileScale) - 0.5));
      grout = clamp(grout, 0.0, 1.0);
      // 줄눈 (어두운 선)
      col = mix(uBaseColor * (0.82 + check * 0.12), uBaseColor * 0.45, grout * 0.7);
      // 콘크리트 미세 노이즈
      float micro = fbm(uv * uTileScale * 4.0) * 0.08;
      col += micro;
      rough = mix(uRoughness, uRoughness * 1.2, grout) + micro * 0.15;

    } else if (uPattern == 1) {
      // Stripe - 금속 패널
      float s = fract(uv.x * uTileScale * 0.5);
      float edge = smoothstep(0.44, 0.50, s) - smoothstep(0.50, 0.56, s);
      col = uBaseColor * (0.85 + s * 0.25);
      // 스크래치 노이즈
      float scratch = fbm(uv * vec2(uTileScale * 0.2, uTileScale * 8.0)) * 0.06;
      col += scratch;
      rough = mix(0.2, 0.55, s) + scratch;

    } else if (uPattern == 2) {
      // Noise - 거친 암석/흙
      float n1 = fbm(uv * uTileScale * 1.5);
      float n2 = fbm(uv * uTileScale * 3.0 + 5.3);
      col = uBaseColor * (0.7 + n1 * 0.5);
      col = mix(col, uBaseColor * 1.3, n2 * 0.3);
      rough = 0.75 + n1 * 0.25;

    } else if (uPattern == 3) {
      // Solid - 매끈한 금속/플라스틱
      float micro = fbm(uv * uTileScale * 8.0) * 0.03;
      col = uBaseColor + micro;
      rough = uRoughness + micro * 0.2;

    } else if (uPattern == 4) {
      // Concrete - 콘크리트 + 균열
      float base = fbm(uv * uTileScale * 2.0);
      float crack = fbm(uv * uTileScale * 0.8 + 3.0);
      float crackMask = smoothstep(0.62, 0.65, crack);
      col = uBaseColor * (0.6 + base * 0.5);
      col = mix(col, uBaseColor * 0.3, crackMask * 0.5);
      rough = 0.85 + base * 0.15;

    } else {
      // Metal - 연마된 금속
      float scratch = fbm(uv * vec2(1.0, uTileScale * 12.0));
      float smear   = fbm(uv * uTileScale * 0.5 + 2.0) * 0.04;
      col   = uBaseColor * (0.85 + scratch * 0.15 + smear);
      rough = max(0.05, uRoughness * (0.3 + scratch * 0.4));
    }

    return vec4(col, clamp(rough, 0.04, 1.0));
  }

  // ── Cook-Torrance BRDF 핵심 함수들 ──
  float distributionGGX(vec3 N, vec3 H, float roughness) {
    float a  = roughness * roughness;
    float a2 = a * a;
    float NdH  = max(dot(N, H), 0.0);
    float NdH2 = NdH * NdH;
    float denom = NdH2 * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * denom * denom);
  }

  float geometrySchlick(float NdV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdV / (NdV * (1.0 - k) + k);
  }

  float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdV = max(dot(N, V), 0.0);
    float NdL = max(dot(N, L), 0.0);
    return geometrySchlick(NdV, roughness) * geometrySchlick(NdL, roughness);
  }

  vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  }

  // ── AO 근사 (화면 공간 없이 월드 공간 법선 기반) ──
  float localAO(vec3 N) {
    // 바닥을 향할수록 AO 증가
    return 0.75 + 0.25 * max(0.0, N.y);
  }

  // ── PCF 소프트 섀도우 (3×3 커널) ──
  float ShadowCalculation(vec4 fragPosLightSpace, vec3 normal, vec3 lightDir) {
    // NDC → [0,1]
    vec3 projCoords = fragPosLightSpace.xyz / fragPosLightSpace.w;
    projCoords = projCoords * 0.5 + 0.5;
    // 라이트 절두체 밖은 그림자 없음
    if (projCoords.z > 1.0) return 0.0;
    float currentDepth = projCoords.z;
    // 경사 바이어스 (그림자 여드름 방지)
    float bias = max(0.005 * (1.0 - dot(normal, lightDir)), 0.0005);
    // 3×3 PCF
    float shadow = 0.0;
    vec2 texelSize = 1.0 / vec2(textureSize(uShadowMap, 0));
    for (int x = -1; x <= 1; ++x) {
      for (int y = -1; y <= 1; ++y) {
        float pcfDepth = texture2D(uShadowMap, projCoords.xy + vec2(x, y) * texelSize).r;
        shadow += currentDepth - bias > pcfDepth ? 1.0 : 0.0;
      }
    }
    return shadow / 9.0;
  }

  void main() {
    vec2 uv = vUv;

    // 패턴별 알베도 + 러프니스 계산
    vec4 pr = getPatternAlbedoRoughness(uv);
    vec3 albedo   = clamp(pr.rgb, 0.0, 1.0);
    float roughness = clamp(pr.a, 0.04, 1.0);
    float metalness = uMetalness;

    // 프로시저럴 노멀맵 적용
    float normalStrength = (uPattern == 2) ? 4.0 : (uPattern == 0) ? 2.5 : 1.5;
    vec3 procN = proceduralNormal(uv * uTileScale, normalStrength);
    // 탄젠트 공간 → 월드 공간 근사 (법선 교란)
    vec3 N = normalize(vNormal);
    // 법선을 약하게 교란 (표면 높이 기반)
    N = normalize(N + procN * 0.35);

    vec3 V = normalize(vViewPos);

    // F0 (프레넬 기저) - 금속이면 알베도 색상, 비금속이면 0.04
    vec3 F0 = mix(vec3(0.04), albedo, metalness);

    // ── 태양광 (주 방향광) ──
    vec3 L_sun = normalize(uSunDir);
    vec3 H_sun = normalize(V + L_sun);
    float NdL_sun = max(dot(N, L_sun), 0.0);

    vec3 F_sun  = fresnelSchlick(max(dot(H_sun, V), 0.0), F0);
    float D_sun = distributionGGX(N, H_sun, roughness);
    float G_sun = geometrySmith(N, V, L_sun, roughness);

    vec3 specSun = (D_sun * G_sun * F_sun) / max(4.0 * max(dot(N,V),0.0) * NdL_sun, 0.001);
    vec3 kD_sun  = (1.0 - F_sun) * (1.0 - metalness);
    vec3 diffSun = kD_sun * albedo / 3.14159265;
    vec3 sunContrib = (diffSun + specSun) * uSunColor * uSunIntensity * NdL_sun;

    // ── PCF 그림자: 햇빛을 못 받는 곳에 그림자 적용 ──
    float shadow = ShadowCalculation(vFragPosLightSpace, N, L_sun);
    sunContrib *= (1.0 - shadow * 0.75);  // 0.75: 완전 암흑 방지 (ambient가 남아있음)

    // ── 보조광 (fill light) ──
    vec3 L_fill = normalize(-uSunDir * vec3(1,0,1) + vec3(0,1,0));
    float NdL_fill = max(dot(N, L_fill), 0.0);
    vec3 fillContrib = albedo * uFillColor * uFillIntensity * NdL_fill * (1.0 - metalness);

    // ── 환경광 (ambient) ──
    float ao = localAO(N);
    vec3 ambientContrib = albedo * uAmbientColor * uAmbientIntensity * ao;

    // ── 스카이 리플렉션 (간단한 GGX 환경 반사 근사) ──
    vec3 R = reflect(-V, N);
    float skyFresnel = fresnelSchlick(max(dot(N, V), 0.0), F0).r;
    // 하늘 방향(위)은 밝고, 땅 방향(아래)은 어둠
    float skyMix = max(0.0, R.y * 0.5 + 0.5);
    vec3 skyColor = mix(vec3(0.08, 0.10, 0.16), vec3(0.42, 0.60, 0.85), skyMix);
    vec3 envRefl  = skyColor * skyFresnel * (1.0 - roughness * 0.8) * (0.4 + metalness * 1.2);

    // ── 최종 컬러 합산 ──
    vec3 finalColor = ambientContrib + sunContrib + fillContrib + envRefl;

    // ── 톤 매핑 (Reinhard 변형) - ACES는 렌더러가 이미 처리 ──
    finalColor = finalColor / (finalColor + 0.5);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.width  = window.innerWidth;
    this.height = window.innerHeight;

    // ── WebGL Renderer ──
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled  = true;
    this.renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace   = THREE.SRGBColorSpace;
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x6699cc);
    // 물리 기반 조명 활성화
    this.renderer.physicallyCorrectLights = true;

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

    // ── 무기 씬 조명 — 순수 중성 흰색만 사용 (색 오염 없음) ──
    this.weaponScene.add(new THREE.AmbientLight(0xffffff, 0.9));

    // 주광: 정면 위쪽 — 총기 상단 하이라이트
    const wKey = new THREE.DirectionalLight(0xffffff, 2.8);
    wKey.position.set(1, 4, 3);
    this.weaponScene.add(wKey);

    // 보조광: 왼쪽 — 그림자 완화 (중성 흰색)
    const wFill = new THREE.DirectionalLight(0xffffff, 1.0);
    wFill.position.set(-3, 1, 2);
    this.weaponScene.add(wFill);

    // 림라이트: 뒤 위쪽 — 금속 엣지 강조 (흰색)
    const wRim = new THREE.DirectionalLight(0xffffff, 0.6);
    wRim.position.set(0, 3, -4);
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

  // ── 고품질 프로시저럴 텍스처 ──
  // 기존 _makeTex는 UV 참조용 더미 텍스처만 생성 (실제 시각은 쉐이더에서 처리)
  _makeTex(c1, c2, pattern = 'checker') {
    const size = 128;
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
    tex.magFilter   = THREE.LinearFilter;
    tex.minFilter   = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
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

  // ── 프로시저럴 하늘 환경 큐브맵 (PMREMGenerator 없이 수동 생성) ──
  _buildEnvMap() {
    // 단순 gradient 큐브맵 (6면)
    const size = 64;
    const faces = [];
    const skyTop    = [0x6e, 0xa8, 0xdf]; // 밝은 하늘색
    const skyHorizon= [0xb0, 0xcc, 0xe8]; // 지평선
    const skyGround = [0x3a, 0x3a, 0x3a]; // 땅

    for (let face = 0; face < 6; face++) {
      const data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const t = y / (size - 1);
          let col;
          if (face === 2) { // +Y (top)
            col = skyTop;
          } else if (face === 3) { // -Y (bottom)
            col = skyGround;
          } else { // sides
            col = [
              Math.round(skyHorizon[0] * (1-t) + skyTop[0] * t),
              Math.round(skyHorizon[1] * (1-t) + skyTop[1] * t),
              Math.round(skyHorizon[2] * (1-t) + skyTop[2] * t),
            ];
          }
          const i = (y * size + x) * 4;
          data[i] = col[0]; data[i+1] = col[1]; data[i+2] = col[2]; data[i+3] = 255;
        }
      }
      faces.push(new THREE.DataTexture(data, size, size));
      faces[face].needsUpdate = true;
    }

    const cubeTexture = new THREE.CubeTexture(faces.map(f => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      return canvas;
    }));
    return cubeTexture; // 쉐이더에서 직접 환경 계산하므로 참조용만
  }

  // ── 쉐이더 유니폼 생성 헬퍼 ──
  _makeBoxUniforms(hex, patternIdx, roughness = 0.7, metalness = 0.0, tileScale = 4.0) {
    const color = new THREE.Color(hex);
    return {
      uBaseColor:        { value: new THREE.Vector3(color.r, color.g, color.b) },
      uRoughness:        { value: roughness },
      uMetalness:        { value: metalness },
      uTileScale:        { value: tileScale },
      uPattern:          { value: patternIdx },
      uTime:             { value: 0.0 },
      uSunDir:           { value: new THREE.Vector3(-20, 60, -20).normalize() },
      uSunColor:         { value: new THREE.Vector3(1.0, 0.95, 0.82) },
      uSunIntensity:     { value: 2.8 },
      uFillColor:        { value: new THREE.Vector3(0.67, 0.8, 1.0) },
      uFillIntensity:    { value: 0.5 },
      uAmbientColor:     { value: new THREE.Vector3(0.55, 0.60, 0.70) },
      uAmbientIntensity: { value: 0.9 },
      uShadowMap:        { value: null },
      uLightSpaceMatrix: { value: new THREE.Matrix4() },
    };
  }

  // ── 패턴 키 → 패턴 인덱스 + PBR 파라미터 ──
  _patternParams(tk, hex) {
    // 색상 명도로 금속/거칠기 추측
    const col = new THREE.Color(hex);
    const lum = 0.299 * col.r + 0.587 * col.g + 0.114 * col.b;
    switch(tk) {
      case 'checker': return { idx: 0, rough: 0.80, metal: 0.0,  tile: 3.0 };
      case 'stripe':  return { idx: 1, rough: 0.35, metal: 0.65, tile: 4.0 };
      case 'noise':   return { idx: 2, rough: 0.85, metal: 0.0,  tile: 3.5 };
      case 'solid':
        // 밝은 색상 → 페인트, 어두운 색상 → 금속
        if (lum < 0.12) return { idx: 5, rough: 0.15, metal: 0.95, tile: 6.0 };
        return { idx: 3, rough: 0.55, metal: 0.1,  tile: 5.0 };
      default:        return { idx: 3, rough: 0.7,  metal: 0.0,  tile: 4.0 };
    }
  }

  _setupLights() {
    // 환경광 (약하게 - PBR 쉐이더가 처리)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    // 태양광 - 더 강하고 따뜻한 색상
    this.sunLight = new THREE.DirectionalLight(0xfff2cc, 2.5);
    this.sunLight.position.set(-20, 60, -20);
    this.sunLight.castShadow = true;
    const sh = this.sunLight.shadow;
    sh.mapSize.set(4096, 4096);  // 고해상도 그림자맵
    sh.camera.near = 1; sh.camera.far = 300;
    sh.camera.left = -120; sh.camera.right  = 120;
    sh.camera.top  =  120; sh.camera.bottom = -120;
    sh.bias = -0.0002;
    sh.normalBias = 0.02;        // 피터팬 현상 방지
    sh.radius = 3;               // 소프트 그림자 반경
    this.scene.add(this.sunLight);

    // 보조광 (하늘빛 반사)
    const fill = new THREE.DirectionalLight(0x8ab4e8, 0.6);
    fill.position.set(20, 20, 20);
    this.scene.add(fill);

    // 반구광 (지면 ↔ 하늘 그라디언트 환경광)
    const hemi = new THREE.HemisphereLight(0x9fc8f0, 0x4a3c28, 0.5);
    this.scene.add(hemi);
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
      duel: {
        name: 'DUEL ARENA',
        background: 0x0a0a0f,
        boxes: [
          // 바닥
          [0,-0.5,0, 40,0.5,40, 0x111122,'checker'],
          // 외곽 벽 4면
          [0,3,20,  40,6,0.5, 0x1a1a2e,'solid'],
          [0,3,-20, 40,6,0.5, 0x1a1a2e,'solid'],
          [20,3,0,  0.5,6,40, 0x1a1a2e,'solid'],
          [-20,3,0, 0.5,6,40, 0x1a1a2e,'solid'],

          // ── 중앙 구조물 ──
          [0,1,0, 4,2,4, 0x9933dd,'noise'],              // 중앙 보라 코어
          [0,3,0, 6,0.5,6, 0xcc66ff,'solid'],            // 코어 상단 플랫폼

          // ── 좌우 대칭 중간 엄폐물 ──
          [-12,1,0, 2,2,6, 0x2233aa,'solid'],            // 좌 큰 벽
          [12,1,0,  2,2,6, 0x2233aa,'solid'],            // 우 큰 벽
          [-8,2,8,  3,0.5,3, 0x334488,'solid'],          // 좌-앞 플랫폼
          [8,2,8,   3,0.5,3, 0x334488,'solid'],          // 우-앞 플랫폼
          [-8,2,-8, 3,0.5,3, 0x334488,'solid'],          // 좌-뒤 플랫폼
          [8,2,-8,  3,0.5,3, 0x334488,'solid'],          // 우-뒤 플랫폼

          // ── 스폰 근처 낮은 엄폐물 ──
          [0,1,14,  6,1,1, 0x445566,'solid'],            // 앞 엄폐 벽
          [0,1,-14, 6,1,1, 0x445566,'solid'],            // 뒤 엄폐 벽
          [-6,1,10, 1,1,4, 0x445566,'solid'],
          [6,1,10,  1,1,4, 0x445566,'solid'],
          [-6,1,-10,1,1,4, 0x445566,'solid'],
          [6,1,-10, 1,1,4, 0x445566,'solid'],

          // ── 코너 점프 발판 ──
          [-16,2,16, 3,0.5,3, 0x223355,'solid'],
          [16,2,16,  3,0.5,3, 0x223355,'solid'],
          [-16,2,-16,3,0.5,3, 0x223355,'solid'],
          [16,2,-16, 3,0.5,3, 0x223355,'solid'],
          [-16,4,16, 2,0.5,2, 0x334466,'solid'],
          [16,4,16,  2,0.5,2, 0x334466,'solid'],
          [-16,4,-16,2,0.5,2, 0x334466,'solid'],
          [16,4,-16, 2,0.5,2, 0x334466,'solid'],

          // ── 하이그라운드 사이드 레일 ──
          [-18,4,0, 2,0.5,12, 0x1a2244,'solid'],
          [18,4,0,  2,0.5,12, 0x1a2244,'solid'],
        ],
      },
    };
    return maps[mapId] || maps.spire;
  }  _buildWorld(mapId = 'spire') {
    for (const group of this.worldGroups || []) this.scene.remove(group);
    this.boxMeshes = [];
    this.jumpPads = [];
    this.airPoints = [];
    this.worldGroups = [];
    // 쉐이더 유니폼 태양 방향 (정규화)
    const sunDir = new THREE.Vector3(-20, 60, -20).normalize();

    const map = this._mapData(mapId);
    this.mapId = mapId;
    localStorage.setItem('vp_map_id', mapId);
    this.scene.background = new THREE.Color(map.background);
    this.scene.fog.color.set(map.background);

    // 맵별 환경광/태양 색상 조정
    const mapEnv = {
      spire:   { sun: [1.00, 0.95, 0.80], amb: [0.55, 0.62, 0.72], fill: [0.67, 0.80, 1.00] },
      circuit: { sun: [0.60, 0.80, 1.00], amb: [0.20, 0.28, 0.45], fill: [0.40, 0.60, 1.00] },
      crater:  { sun: [1.00, 0.70, 0.40], amb: [0.45, 0.35, 0.28], fill: [0.80, 0.55, 0.30] },
      duel:    { sun: [0.70, 0.70, 1.00], amb: [0.20, 0.20, 0.35], fill: [0.50, 0.50, 0.90] },
    };
    const env = mapEnv[mapId] || mapEnv.spire;

    // 쉐이더 공유 유니폼 값 (맵별)
    const sharedUniforms = {
      sunDir:   sunDir,
      sunColor: new THREE.Vector3(...env.sun),
      ambColor: new THREE.Vector3(...env.amb),
      fillColor:new THREE.Vector3(...env.fill),
    };

    // 머티리얼 캐시 (동일 hex+패턴은 재사용)
    const matCache = new Map();

    map.boxes.forEach(([x,y,z, sx,sy,sz, hex, tk]) => {
      const geo = new THREE.BoxGeometry(sx*2, sy*2, sz*2);

      // 캐시 키
      const cacheKey = `${hex}_${tk}`;
      let mat;
      if (matCache.has(cacheKey)) {
        mat = matCache.get(cacheKey);
      } else {
        const p = this._patternParams(tk, hex);
        const uniforms = this._makeBoxUniforms(hex, p.idx, p.rough, p.metal, p.tile);
        // 공유 환경 유니폼 오버라이드
        uniforms.uSunDir.value.copy(sharedUniforms.sunDir);
        uniforms.uSunColor.value.copy(sharedUniforms.sunColor);
        uniforms.uAmbientColor.value.copy(sharedUniforms.ambColor);
        uniforms.uFillColor.value.copy(sharedUniforms.fillColor);

        mat = new THREE.ShaderMaterial({
          vertexShader:   BOX_VERT,
          fragmentShader: BOX_FRAG,
          uniforms,
        });
        matCache.set(cacheKey, mat);
      }

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.worldGroups.push(mesh);
      this.boxMeshes.push({ pos:[x,y,z], size:[sx,sy,sz] });
    });

    // 공유 유니폼 참조 저장 (time 업데이트용)
    this._shaderMats = Array.from(matCache.values());

    // ── 지면 반사 플레이트 (아주 얇은 평면, receiveShadow 전용) ──
    // 첫 번째 박스([0,-30,80, 400,1,400])가 지면이므로 위에 얇은 반사레이어 추가
    if (mapId !== 'duel') {
      const groundReflMat = new THREE.MeshStandardMaterial({
        color: map.background,
        roughness: 0.95,
        metalness: 0.0,
        transparent: true,
        opacity: 0.0,  // 완전히 투명 (그림자 수신만)
      });
    }

    this._buildBoosters();
  }

  setMap(mapId) {
    this._buildWorld(mapId);
  }

  // ── 쉐이더 유니폼 업데이트 (게임 루프에서 호출) ──
  updateShaderTime(t) {
    if (!this._shaderMats) return;

    // 그림자맵 + 라이트 공간 행렬 계산
    const shadowTex = this.sunLight?.shadow?.map?.texture ?? null;
    const lightSpaceMat = new THREE.Matrix4();
    if (this.sunLight?.shadow?.camera) {
      lightSpaceMat.multiplyMatrices(
        this.sunLight.shadow.camera.projectionMatrix,
        this.sunLight.shadow.camera.matrixWorldInverse
      );
    }

    for (const mat of this._shaderMats) {
      if (!mat.uniforms) continue;
      if (mat.uniforms.uTime)             mat.uniforms.uTime.value             = t;
      if (mat.uniforms.uShadowMap)        mat.uniforms.uShadowMap.value        = shadowTex;
      if (mat.uniforms.uLightSpaceMatrix) mat.uniforms.uLightSpaceMatrix.value = lightSpaceMat;
    }
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

    // 총 그룹 - group 직접 자식, 중심점은 총 중앙, 몸통 완전히 앞에 배치
    const gunGroup = new THREE.Group();
    gunGroup.position.set(0.3, 1.15, -0.55);
    group.add(gunGroup);

    // 무기별 box mesh 맵 (weapon id → mesh group) — OBJ 로드 전 fallback용
    const weaponMeshes = {};

    // ── 고품질 재질 헬퍼 ──
    const metal  = (color, rough=0.35, metal=0.9) => new THREE.MeshStandardMaterial({ color, roughness:rough, metalness:metal });
    const rubber = (color) => new THREE.MeshStandardMaterial({ color, roughness:0.85, metalness:0.05 });
    const wood   = (color) => new THREE.MeshStandardMaterial({ color, roughness:0.9,  metalness:0.0  });
    const box3p  = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
    const cyl    = (rt, rb, h, s=12) => new THREE.CylinderGeometry(rt, rb, h, s);

    // ── 총구 위치 태그 helper (이펙트 스폰에 사용) ──
    const tagMuzzle = (group, z) => {
      const dummy = new THREE.Object3D();
      dummy.name = 'muzzleTag';
      dummy.position.set(0, 0, z);
      group.add(dummy);
    };

    // m4a1: OBJ 로드되면 대체, 로드 전엔 고품질 박스 fallback
    {
      const g = new THREE.Group();
      // Upper 리시버
      const recv = new THREE.Mesh(box3p(0.068,0.050,0.40), metal(0x1c1c1c));
      recv.position.set(0, 0.022, -0.03);
      // Lower 리시버
      const lowerRecv = new THREE.Mesh(box3p(0.064,0.038,0.28), metal(0x202020,0.5));
      lowerRecv.position.set(0,-0.002,-0.03);
      // 핸드가드 (M-LOK 스타일 — 옆면 슬롯 표현)
      const hg = new THREE.Mesh(box3p(0.074,0.062,0.24), metal(0x252525,0.55));
      hg.position.set(0,0.012,-0.22);
      // 핸드가드 슬롯 (3개 간격)
      for(let i=0;i<3;i++){
        const slot = new THREE.Mesh(box3p(0.076,0.010,0.018),metal(0x111111,0.8));
        slot.position.set(0,-0.006,-0.13-i*0.06); g.add(slot);
      }
      // 피카티니 레일 (탑 — 노치 4개)
      const topRail = new THREE.Mesh(box3p(0.018,0.008,0.38),metal(0x303030));
      topRail.position.set(0,0.050,-0.05);
      for(let i=0;i<6;i++){
        const notch = new THREE.Mesh(box3p(0.020,0.010,0.004),metal(0x111111));
        notch.position.set(0,0.050,-0.22+i*0.052); g.add(notch);
      }
      // 총열 (heavy profile)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,0.38,12),metal(0x252525,0.25,1.0));
      barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.016,-0.30);
      // 가스 블록
      const gasBlock = new THREE.Mesh(box3p(0.032,0.028,0.030),metal(0x1a1a1a,0.3,1));
      gasBlock.position.set(0,0.016,-0.20);
      // 가스 튜브
      const gasTube = new THREE.Mesh(new THREE.CylinderGeometry(0.005,0.005,0.20,6),metal(0x222222,0.4));
      gasTube.rotation.x=Math.PI/2; gasTube.position.set(0,0.034,-0.14);
      // A2 소염기 (3-prong)
      const fh = new THREE.Mesh(new THREE.CylinderGeometry(0.020,0.016,0.055,6),metal(0x111111,0.2,1));
      fh.rotation.x=Math.PI/2; fh.position.set(0,0.016,-0.525);
      // 소염기 프롱 (3개)
      for(let i=0;i<3;i++){
        const pr = new THREE.Mesh(box3p(0.004,0.022,0.018),metal(0x0d0d0d));
        pr.position.set(Math.sin(i*Math.PI*2/3)*0.018, 0.016+Math.cos(i*Math.PI*2/3)*0.018,-0.545);
        g.add(pr);
      }
      // 그립 (polymer 질감)
      const grip = new THREE.Mesh(box3p(0.046,0.128,0.056),rubber(0x181206));
      grip.position.set(0,-0.078,0.052); grip.rotation.x=0.18;
      // 그립 텍스처 (체커링 홈)
      for(let i=0;i<3;i++){
        const groove = new THREE.Mesh(box3p(0.048,0.008,0.030),rubber(0x100c04));
        groove.position.set(0,-0.050-i*0.025,0.055+i*0.005); groove.rotation.x=0.18; g.add(groove);
      }
      // 탄창 (PMAG 스타일)
      const mag = new THREE.Mesh(box3p(0.036,0.118,0.054),metal(0x1e1e1e,0.7,0.1));
      mag.position.set(0,-0.078,-0.048); mag.rotation.x=-0.13;
      const magFloor = new THREE.Mesh(box3p(0.040,0.010,0.058),rubber(0x151515));
      magFloor.position.set(0,-0.140,-0.055); magFloor.rotation.x=-0.13; g.add(magFloor);
      // 탄창 리브 (2줄)
      for(let s=0;s<2;s++){
        const rib = new THREE.Mesh(box3p(0.038,0.006,0.010),metal(0x151515));
        rib.position.set(0,-0.060-s*0.030,-0.045); rib.rotation.x=-0.13; g.add(rib);
      }
      // 개머리판 (M4 folding stock)
      const stock = new THREE.Mesh(box3p(0.052,0.048,0.185),metal(0x1a1a1a,0.5));
      stock.position.set(0,0.010,0.205);
      const stockBuffer = new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,0.065,8),metal(0x141414));
      stockBuffer.rotation.x=Math.PI/2; stockBuffer.position.set(0,0.010,0.315);
      const stockEnd = new THREE.Mesh(box3p(0.060,0.065,0.028),rubber(0x0e0e0e));
      stockEnd.position.set(0,0.012,0.355);
      // 볼트 캐리어 핸들
      const bcg = new THREE.Mesh(box3p(0.012,0.018,0.055),metal(0x282828));
      bcg.position.set(0.038,0.022,-0.005);
      // 차징 핸들
      const ch = new THREE.Mesh(box3p(0.022,0.012,0.025),metal(0x202020));
      ch.position.set(0,0.052,0.085);
      g.add(recv,lowerRecv,hg,topRail,barrel,gasBlock,gasTube,fh,grip,mag,stock,stockBuffer,stockEnd,bcg,ch);
      tagMuzzle(g,-0.555);
      weaponMeshes['m4a1'] = g;
    }

    // sniper (bolt-action — Remington 700 inspired)
    {
      const g = new THREE.Group();
      // 리시버
      const recv = new THREE.Mesh(box3p(0.058,0.060,0.50),metal(0x181818,0.3,0.95));
      recv.position.set(0,0.018,-0.04);
      // 스코프 마운트 링 (2개)
      for(let i=0;i<2;i++){
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.026,0.026,0.022,10),metal(0x222222,0.25,1));
        ring.rotation.x=Math.PI/2; ring.position.set(0,0.065,0.04-i*0.14); g.add(ring);
      }
      // 스코프 베이스 레일
      const sBase = new THREE.Mesh(box3p(0.040,0.014,0.26),metal(0x282828));
      sBase.position.set(0,0.055,-0.02);
      // 스코프 튜브 (30mm)
      const sTube = new THREE.Mesh(new THREE.CylinderGeometry(0.024,0.024,0.30,12),metal(0x181818,0.2,1));
      sTube.rotation.x=Math.PI/2; sTube.position.set(0,0.072,-0.025);
      // 스코프 눈 받침 (eyepiece)
      const eyepiece = new THREE.Mesh(new THREE.CylinderGeometry(0.028,0.022,0.055,12),metal(0x141414,0.25));
      eyepiece.rotation.x=Math.PI/2; eyepiece.position.set(0,0.072,0.140);
      // 렌즈 (파란 반투명)
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022,20),new THREE.MeshStandardMaterial({color:0x112244,roughness:0.05,metalness:0.1,transparent:true,opacity:0.72}));
      lens.rotation.y=Math.PI/2; lens.position.set(0,0.072,-0.180);
      // 렌즈 캡 링
      const lensCap = new THREE.Mesh(new THREE.CylinderGeometry(0.026,0.026,0.010,12),metal(0x111111));
      lensCap.rotation.x=Math.PI/2; lensCap.position.set(0,0.072,-0.183);
      // 조정 다이얼 (엘리베이션 / 윈디지)
      const dialE = new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.012,0.030,8),metal(0x303030));
      dialE.position.set(0,0.100,-0.025);
      const dialW = new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.012,0.030,8),metal(0x303030));
      dialW.rotation.z=Math.PI/2; dialW.position.set(0.038,0.072,-0.025); g.add(dialE,dialW);
      // 총열 (플루팅 — 가벼운 홈 표현)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.013,0.52,12),metal(0x212121,0.2,1));
      barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.012,-0.38);
      // 총열 그루브 (3개)
      for(let i=0;i<3;i++){
        const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.002,0.002,0.42,4),metal(0x141414));
        fl.rotation.x=Math.PI/2; fl.position.set(Math.sin(i*Math.PI*2/3)*0.013,0.012+Math.cos(i*Math.PI*2/3)*0.013,-0.36); g.add(fl);
      }
      // 억제기 (suppressor)
      const supp = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.10,10),metal(0x141414,0.3,1));
      supp.rotation.x=Math.PI/2; supp.position.set(0,0.012,-0.695);
      const suppEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.022,0.012,10),metal(0x0e0e0e));
      suppEnd.rotation.x=Math.PI/2; suppEnd.position.set(0,0.012,-0.752);
      // 볼트 핸들
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.008,0.040,8),metal(0x282828));
      bolt.rotation.z=Math.PI/2; bolt.position.set(0.048,0.018,0.080);
      const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.014,8,8),metal(0x222222,0.3));
      boltKnob.position.set(0.065,0.018,0.080); g.add(bolt,boltKnob);
      // 그립 (wood)
      const grip = new THREE.Mesh(box3p(0.044,0.118,0.054),wood(0x4e3012));
      grip.position.set(0,-0.062,0.062); grip.rotation.x=0.22;
      // 체커링
      for(let i=0;i<4;i++){
        const ck = new THREE.Mesh(box3p(0.046,0.006,0.028),wood(0x3c2408));
        ck.position.set(0,-0.048-i*0.020,0.068+i*0.006); ck.rotation.x=0.22; g.add(ck);
      }
      // 개머리판 (wood)
      const stock = new THREE.Mesh(box3p(0.054,0.062,0.30),wood(0x42280e));
      stock.position.set(0,0.006,0.244);
      // 개머리판 패드
      const stockPad = new THREE.Mesh(box3p(0.060,0.072,0.022),rubber(0x0a0a0a));
      stockPad.position.set(0,0.006,0.406);
      // 방아쇠 가드
      const tg = new THREE.Mesh(new THREE.TorusGeometry(0.022,0.004,6,16,Math.PI),metal(0x1e1e1e));
      tg.rotation.x=-Math.PI/2; tg.position.set(0,-0.025,0.050);
      g.add(recv,sBase,sTube,eyepiece,lens,lensCap,barrel,supp,suppEnd,grip,stock,stockPad,tg);
      tagMuzzle(g,-0.760);
      weaponMeshes['sniper'] = g;
    }

    // pistol (GLOCK 17 style — high detail)
    {
      const g = new THREE.Group();
      // 슬라이드
      const slide = new THREE.Mesh(box3p(0.048,0.068,0.172),metal(0x1a1a1a,0.28,0.92));
      slide.position.set(0,0.026,-0.018);
      // 슬라이드 세레이션 (뒤쪽 6줄 — 앞 4줄)
      for(let i=0;i<6;i++){
        const sr = new THREE.Mesh(box3p(0.050,0.040,0.004),metal(0x0e0e0e,0.5));
        sr.position.set(0,0.026,0.044+i*0.012); g.add(sr);
      }
      for(let i=0;i<4;i++){
        const sr = new THREE.Mesh(box3p(0.050,0.022,0.004),metal(0x0e0e0e,0.5));
        sr.position.set(0,0.018,-0.072-i*0.012); g.add(sr);
      }
      // 슬라이드 윈도우 (ejection port)
      const port = new THREE.Mesh(box3p(0.050,0.020,0.040),metal(0x111111,0.8));
      port.position.set(0,0.042,-0.030);
      // 사이트 (front + rear)
      const rearSight = new THREE.Mesh(box3p(0.030,0.008,0.010),metal(0x282828));
      rearSight.position.set(0,0.064,0.062);
      const frontSight = new THREE.Mesh(box3p(0.008,0.010,0.006),metal(0x282828));
      frontSight.position.set(0,0.062,-0.096);
      // 프레임
      const frame = new THREE.Mesh(box3p(0.044,0.082,0.168),rubber(0x1e1e1e));
      frame.position.set(0,-0.020,-0.010);
      // 그립 텍스처 (체커링)
      for(let i=0;i<5;i++){
        const gp = new THREE.Mesh(box3p(0.046,0.008,0.040),rubber(0x141414));
        gp.position.set(0,-0.038-i*0.016,0.014); g.add(gp);
      }
      // 총열
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011,0.011,0.130,10),metal(0x2c2c2c,0.2,1));
      barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.022,-0.096);
      // 총구 크라운
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.011,0.008,10),metal(0x1e1e1e));
      crown.rotation.x=Math.PI/2; crown.position.set(0,0.022,-0.165);
      // 방아쇠 가드
      const tg = new THREE.Mesh(box3p(0.040,0.008,0.075),rubber(0x1a1a1a));
      tg.position.set(0,-0.052,-0.040);
      // 방아쇠
      const trigger = new THREE.Mesh(box3p(0.006,0.028,0.010),metal(0x282828));
      trigger.position.set(0,-0.044,-0.012); trigger.rotation.x=0.25;
      // 탄창
      const mag = new THREE.Mesh(box3p(0.036,0.092,0.042),metal(0x181818,0.5,0.5));
      mag.position.set(0,-0.055,0.018);
      const magBase = new THREE.Mesh(box3p(0.040,0.008,0.048),rubber(0x111111));
      magBase.position.set(0,-0.104,0.018);
      // 레일 (언더배럴)
      const urai = new THREE.Mesh(box3p(0.020,0.008,0.055),metal(0x222222));
      urai.position.set(0,-0.008,-0.055);
      g.add(slide,port,rearSight,frontSight,frame,barrel,crown,tg,trigger,mag,magBase,urai);
      tagMuzzle(g,-0.172);
      weaponMeshes['pistol'] = g;
    }

    // smg (MP5 style)
    {
      const g = new THREE.Group();
      // 리시버
      const recv = new THREE.Mesh(box3p(0.065,0.070,0.330),metal(0x1c1c1c,0.38,0.85));
      recv.position.set(0,0.012,0.00);
      // 코킹 채널 (슬롯)
      const cockSlot = new THREE.Mesh(box3p(0.010,0.012,0.110),metal(0x0e0e0e));
      cockSlot.position.set(0.038,0.012,0.005);
      // 코킹 핸들
      const cockH = new THREE.Mesh(box3p(0.014,0.014,0.018),metal(0x252525));
      cockH.position.set(0.038,0.012,0.005);
      // 핸드가드 (polymer)
      const hg = new THREE.Mesh(box3p(0.072,0.060,0.140),rubber(0x1a1a1a));
      hg.position.set(0,0.006,-0.155);
      // 핸드가드 벤트 (3줄)
      for(let i=0;i<3;i++){
        const v = new THREE.Mesh(box3p(0.074,0.010,0.016),metal(0x111111));
        v.position.set(0,-0.002,-0.10-i*0.030); g.add(v);
      }
      // 총열
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011,0.011,0.160,10),metal(0x282828,0.22,1));
      barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.010,-0.225);
      // 나이트사이트 소염기 (3-lug)
      const fh = new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.013,0.035,6),metal(0x111111,0.2,1));
      fh.rotation.x=Math.PI/2; fh.position.set(0,0.010,-0.320);
      // 조준기 (후방 드럼 사이트)
      const diopter = new THREE.Mesh(new THREE.CylinderGeometry(0.014,0.014,0.012,8),metal(0x303030));
      diopter.rotation.x=Math.PI/2; diopter.position.set(0,0.052,0.048);
      const frontPost = new THREE.Mesh(box3p(0.008,0.014,0.010),metal(0x282828));
      frontPost.position.set(0,0.048,-0.090);
      // 그립
      const grip = new THREE.Mesh(box3p(0.050,0.108,0.050),rubber(0x141414));
      grip.position.set(0,-0.060,0.068); grip.rotation.x=0.16;
      // 탄창 (곡선 매거진)
      const mag = new THREE.Mesh(box3p(0.038,0.108,0.048),metal(0x1e1e1e,0.6,0.2));
      mag.position.set(0,-0.055,-0.040); mag.rotation.x=-0.08;
      const magBase = new THREE.Mesh(box3p(0.040,0.010,0.052),rubber(0x111111));
      magBase.position.set(0,-0.110,-0.045); magBase.rotation.x=-0.08;
      // 개머리판 (접이식 MP5 스타일)
      const stockL = new THREE.Mesh(box3p(0.008,0.048,0.170),metal(0x1a1a1a));
      stockL.position.set(0.035,0.012,0.195);
      const stockR = new THREE.Mesh(box3p(0.008,0.048,0.170),metal(0x1a1a1a));
      stockR.position.set(-0.035,0.012,0.195);
      const stockEnd2 = new THREE.Mesh(box3p(0.080,0.048,0.014),rubber(0x101010));
      stockEnd2.position.set(0,0.012,0.282);
      g.add(recv,cockSlot,cockH,hg,barrel,fh,diopter,frontPost,grip,mag,magBase,stockL,stockR,stockEnd2);
      tagMuzzle(g,-0.340);
      weaponMeshes['smg'] = g;
    }

    // shotgun (Mossberg 500 style — pump action)
    {
      const g = new THREE.Group();
      // 리시버 (알루미늄 느낌)
      const recv = new THREE.Mesh(box3p(0.070,0.068,0.420),metal(0x1c1c1c,0.45,0.8));
      recv.position.set(0,0.012,-0.02);
      // 리시버 사이드 각인 (우측 플레이트)
      const plate = new THREE.Mesh(box3p(0.002,0.045,0.220),metal(0x222222,0.35));
      plate.position.set(0.037,0.012,-0.02);
      // 듀얼 배럴 (나란히 — double-barrel look)
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.019,0.019,0.430,10),metal(0x202020,0.28,1));
      b1.rotation.x=Math.PI/2; b1.position.set(0.012,0.010,-0.315);
      const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.019,0.019,0.430,10),metal(0x202020,0.28,1));
      b2.rotation.x=Math.PI/2; b2.position.set(-0.012,0.010,-0.315);
      // 배럴 밴드 (3개)
      for(let i=0;i<3;i++){
        const band = new THREE.Mesh(box3p(0.050,0.042,0.012),metal(0x181818,0.3));
        band.position.set(0,0.010,-0.14-i*0.12); g.add(band);
      }
      // 총구 아래 튜브 (매거진)
      const magTube = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.380,10),metal(0x1a1a1a,0.4));
      magTube.rotation.x=Math.PI/2; magTube.position.set(0,-0.016,-0.30);
      // 펌프 핸드가드 (wood)
      const pump = new THREE.Mesh(box3p(0.075,0.055,0.160),wood(0x5c3822));
      pump.position.set(0,0.004,-0.268);
      // 펌프 홈
      for(let i=0;i<5;i++){
        const pg = new THREE.Mesh(box3p(0.077,0.010,0.010),wood(0x3e2410));
        pg.position.set(0,0.008,-0.208-i*0.022); g.add(pg);
      }
      // 그립/개머리판 (wood)
      const stock = new THREE.Mesh(box3p(0.058,0.075,0.260),wood(0x503016));
      stock.position.set(0,0.006,0.218);
      const stockPad = new THREE.Mesh(box3p(0.064,0.082,0.018),rubber(0x0c0c0c));
      stockPad.position.set(0,0.006,0.350);
      const grip = new THREE.Mesh(box3p(0.050,0.105,0.055),wood(0x503016));
      grip.position.set(0,-0.054,0.058); grip.rotation.x=0.20;
      // 방아쇠 가드 (강재)
      const tg = new THREE.Mesh(box3p(0.046,0.008,0.070),metal(0x1e1e1e));
      tg.position.set(0,-0.040,-0.005);
      // 사이트 (비드)
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.006,8,8),metal(0xcccccc,0.1));
      bead.position.set(0,0.035,-0.528);
      g.add(recv,plate,b1,b2,magTube,pump,stock,stockPad,grip,tg,bead);
      tagMuzzle(g,-0.538);
      weaponMeshes['shotgun'] = g;
    }

    // lmg (M249 SAW style)
    {
      const g = new THREE.Group();
      // 리시버 (헤비 steel)
      const recv = new THREE.Mesh(box3p(0.078,0.078,0.510),metal(0x181818,0.5,0.8));
      recv.position.set(0,0.015,-0.04);
      // 상단 레일
      const tRail = new THREE.Mesh(box3p(0.020,0.008,0.38),metal(0x282828));
      tRail.position.set(0,0.058,-0.05);
      for(let i=0;i<7;i++){
        const n=new THREE.Mesh(box3p(0.022,0.010,0.004),metal(0x141414));
        n.position.set(0,0.058,-0.22+i*0.06); g.add(n);
      }
      // 핸드가드 (heat shield 스타일)
      const hg = new THREE.Mesh(box3p(0.084,0.064,0.240),metal(0x222222,0.6));
      hg.position.set(0,0.010,-0.255);
      // 히트실드 벤트 (가로 4줄)
      for(let i=0;i<4;i++){
        const hv=new THREE.Mesh(box3p(0.086,0.012,0.018),metal(0x111111));
        hv.position.set(0,-0.000,-0.175-i*0.038); g.add(hv);
      }
      // 총열 (헤비 배럴)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.470),metal(0x1c1c1c,0.22,1));
      barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.014,-0.385);
      // 소염기 (birdcage)
      const fh = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.018,0.065,6),metal(0x111111,0.2));
      fh.rotation.x=Math.PI/2; fh.position.set(0,0.014,-0.648);
      // 바이포드 (접이식)
      const bpLA = new THREE.Mesh(new THREE.CylinderGeometry(0.007,0.007,0.175,6),metal(0x202020));
      bpLA.position.set(0.032,-0.055,-0.285); bpLA.rotation.z=0.28;
      const bpRA = new THREE.Mesh(new THREE.CylinderGeometry(0.007,0.007,0.175,6),metal(0x202020));
      bpRA.position.set(-0.032,-0.055,-0.285); bpRA.rotation.z=-0.28;
      const bpLB = new THREE.Mesh(new THREE.CylinderGeometry(0.005,0.007,0.080,6),metal(0x1a1a1a));
      bpLB.position.set(0.028,-0.132,-0.275); bpLB.rotation.z=0.15;
      const bpRB = new THREE.Mesh(new THREE.CylinderGeometry(0.005,0.007,0.080,6),metal(0x1a1a1a));
      bpRB.position.set(-0.028,-0.132,-0.275); bpRB.rotation.z=-0.15;
      // 탄약통 박스 (100발 — 오른쪽에 장착)
      const ammoBox = new THREE.Mesh(box3p(0.088,0.095,0.135),metal(0x2c2c2c,0.7,0.2));
      ammoBox.position.set(0,-0.072,-0.025);
      const ammoBoxLid = new THREE.Mesh(box3p(0.090,0.006,0.137),metal(0x242424));
      ammoBoxLid.position.set(0,-0.026,-0.025);
      // 탄약 벨트 피드
      const feedCover = new THREE.Mesh(box3p(0.080,0.014,0.090),metal(0x1e1e1e));
      feedCover.position.set(0,0.052,-0.010);
      // 그립
      const grip = new THREE.Mesh(box3p(0.050,0.112,0.052),rubber(0x121212));
      grip.position.set(0,-0.062,0.080); grip.rotation.x=0.14;
      // 개머리판 (경량 skeleton)
      const stkL = new THREE.Mesh(box3p(0.008,0.054,0.200),metal(0x1a1a1a));
      stkL.position.set(0.026,0.012,0.230);
      const stkR = new THREE.Mesh(box3p(0.008,0.054,0.200),metal(0x1a1a1a));
      stkR.position.set(-0.026,0.012,0.230);
      const stk2 = new THREE.Mesh(box3p(0.060,0.014,0.015),metal(0x1a1a1a));
      stk2.position.set(0,0.012,0.175);
      const stkEnd3 = new THREE.Mesh(box3p(0.064,0.065,0.022),rubber(0x0e0e0e));
      stkEnd3.position.set(0,0.012,0.332);
      g.add(recv,tRail,hg,barrel,fh,bpLA,bpRA,bpLB,bpRB,ammoBox,ammoBoxLid,feedCover,grip,stkL,stkR,stk2,stkEnd3);
      tagMuzzle(g,-0.685);
      weaponMeshes['lmg'] = g;
    }

    // dmr (VANTAGE — SR-25 style)
    {
      const g = new THREE.Group();
      const recv = new THREE.Mesh(box3p(0.058,0.060,0.440),metal(0x14141e,0.32,0.92));
      recv.position.set(0,0.016,-0.03);
      // 레일 시스템 (M-LOK)
      const topR = new THREE.Mesh(box3p(0.018,0.008,0.340),metal(0x242430));
      topR.position.set(0,0.050,-0.03);
      for(let i=0;i<5;i++){
        const n=new THREE.Mesh(box3p(0.020,0.010,0.004),metal(0x101018));
        n.position.set(0,0.050,-0.18+i*0.065); g.add(n);
      }
      // 스코프 마운트
      for(let i=0;i<2;i++){
        const sm=new THREE.Mesh(new THREE.CylinderGeometry(0.024,0.024,0.020,10),metal(0x1e1e28));
        sm.rotation.x=Math.PI/2; sm.position.set(0,0.066,0.02-i*0.14); g.add(sm);
      }
      // 스코프
      const sTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.280,12),metal(0x181828,0.2,1));
      sTube.rotation.x=Math.PI/2; sTube.position.set(0,0.070,-0.025);
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.026,0.022,0.050,12),metal(0x121218));
      eye.rotation.x=Math.PI/2; eye.position.set(0,0.070,0.140);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.021,20),new THREE.MeshStandardMaterial({color:0x0a1a44,roughness:0.05,transparent:true,opacity:0.75}));
      lens.rotation.y=Math.PI/2; lens.position.set(0,0.070,-0.170);
      // 총열 (heavy fluted)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014,0.014,0.360,12),metal(0x1e1e2a,0.2,1));
      barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.012,-0.340);
      // 소염기 (슬리핀 brake)
      const muz = new THREE.Mesh(new THREE.CylinderGeometry(0.020,0.014,0.070,8),metal(0x10101a,0.2,1));
      muz.rotation.x=Math.PI/2; muz.position.set(0,0.012,-0.555);
      // 가스 블록
      const gb = new THREE.Mesh(box3p(0.032,0.024,0.028),metal(0x18182a));
      gb.position.set(0,0.012,-0.220);
      // 핸드가드
      const hg = new THREE.Mesh(box3p(0.070,0.058,0.220),metal(0x202030,0.5));
      hg.position.set(0,0.008,-0.200);
      // 탄창 (SR-25 style — 20발)
      const mag = new THREE.Mesh(box3p(0.036,0.105,0.050),metal(0x181828,0.5));
      mag.position.set(0,-0.068,-0.040); mag.rotation.x=-0.12;
      // 그립
      const grip = new THREE.Mesh(box3p(0.044,0.112,0.050),rubber(0x10101a));
      grip.position.set(0,-0.064,0.055); grip.rotation.x=0.20;
      // 개머리판 (precision adjustable)
      const stk = new THREE.Mesh(box3p(0.050,0.050,0.180),metal(0x14141e));
      stk.position.set(0,0.010,0.198);
      const stkBuf = new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.015,0.060,8),metal(0x101018));
      stkBuf.rotation.x=Math.PI/2; stkBuf.position.set(0,0.010,0.298);
      const stkEnd4 = new THREE.Mesh(box3p(0.058,0.060,0.025),rubber(0x0c0c0c));
      stkEnd4.position.set(0,0.010,0.340);
      g.add(recv,topR,sTube,eye,lens,barrel,muz,gb,hg,mag,grip,stk,stkBuf,stkEnd4);
      tagMuzzle(g,-0.595);
      weaponMeshes['dmr'] = g;
    }

    // burst (PULSE — futuristic bullpup)
    {
      const g = new THREE.Group();
      // 메인 바디 (불펍 — 탄창이 뒤에)
      const body = new THREE.Mesh(box3p(0.064,0.072,0.400),metal(0x0a1628,0.28,0.88));
      body.position.set(0,0.012,-0.005);
      // 에너지 코일 채널 (탑)
      const chan = new THREE.Mesh(box3p(0.016,0.008,0.320),new THREE.MeshStandardMaterial({color:0x0044aa,emissive:0x001133,roughness:0.3,metalness:0.8}));
      chan.position.set(0,0.040,-0.020);
      // 홀로 사이트
      const holoBase = new THREE.Mesh(box3p(0.030,0.008,0.030),metal(0x1a2a3a));
      holoBase.position.set(0,0.050,-0.080);
      const holoFrame = new THREE.Mesh(new THREE.TorusGeometry(0.016,0.003,6,16),metal(0x1a2a3a));
      holoFrame.position.set(0,0.066,-0.080);
      const holoLens = new THREE.Mesh(new THREE.CircleGeometry(0.015,16),new THREE.MeshStandardMaterial({color:0x003344,transparent:true,opacity:0.4,roughness:0.0}));
      holoLens.position.set(0,0.066,-0.080);
      // 총열 (에너지 스타일 — 각진)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.012,0.220,8),metal(0x0044aa,0.2,1));
      barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.010,-0.260);
      // 총구 (에너지 링)
      for(let i=0;i<3;i++){
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.020,0.016,0.012,8),new THREE.MeshStandardMaterial({color:0x0066cc,emissive:0x002244,roughness:0.2,metalness:0.9}));
        ring.rotation.x=Math.PI/2; ring.position.set(0,0.010,-0.350-i*0.018); g.add(ring);
      }
      // 방아쇠 가드 (미래형)
      const tg = new THREE.Mesh(box3p(0.042,0.010,0.080),metal(0x0c1a2a,0.4));
      tg.position.set(0,-0.040,-0.040);
      // 그립 (에르고)
      const grip = new THREE.Mesh(box3p(0.046,0.106,0.050),rubber(0x060e18));
      grip.position.set(0,-0.058,0.010); grip.rotation.x=0.10;
      // 탄창 (불펍 — 뒤에 위치)
      const mag = new THREE.Mesh(box3p(0.036,0.108,0.048),new THREE.MeshStandardMaterial({color:0x0a1e38,roughness:0.5,metalness:0.7}));
      mag.position.set(0,-0.054,0.165); mag.rotation.x=-0.06;
      // 개머리판 (일체형)
      const stkB = new THREE.Mesh(box3p(0.060,0.055,0.028),rubber(0x080e18));
      stkB.position.set(0,0.010,0.210);
      g.add(body,chan,holoBase,holoFrame,holoLens,barrel,tg,grip,mag,stkB);
      tagMuzzle(g,-0.405);
      weaponMeshes['burst'] = g;
    }

    // rail (RAIL GUN — electromagnetic)
    {
      const g = new THREE.Group();
      // 메인 바디
      const body = new THREE.Mesh(box3p(0.055,0.062,0.560),metal(0x090912,0.18,0.98));
      body.position.set(0,0.012,-0.055);
      // 레일 가이드 (양옆 — 알루미늄)
      const rL = new THREE.Mesh(box3p(0.010,0.044,0.520),metal(0x1a22cc,0.12,1.0));
      rL.position.set(0.032,0.012,-0.055);
      const rR = new THREE.Mesh(box3p(0.010,0.044,0.520),metal(0x1a22cc,0.12,1.0));
      rR.position.set(-0.032,0.012,-0.055);
      // 전하 코일 (8개 — 발광)
      for(let i=0;i<8;i++){
        const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.032,0.032,0.016,10),new THREE.MeshStandardMaterial({color:0x2244ee,emissive:0x0a1166,roughness:0.15,metalness:0.95}));
        coil.rotation.x=Math.PI/2; coil.position.set(0,0.012,0.020-i*0.080); g.add(coil);
        // 코일 사이 갭 글로우
        const gapGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.008,0.012,6),new THREE.MeshStandardMaterial({color:0x4488ff,emissive:0x2244ff,roughness:0.0}));
        gapGlow.rotation.x=Math.PI/2; gapGlow.position.set(0,0.012,0.012-i*0.080); g.add(gapGlow);
      }
      // 총열 코어 (plasma channel)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.010,0.010,0.440),new THREE.MeshStandardMaterial({color:0x1133bb,emissive:0x081166,roughness:0.1,metalness:1.0}));
      barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.012,-0.375);
      // 총구 가속기
      const accel = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.032,0.055,10),metal(0x0a0a1a,0.15,1));
      accel.rotation.x=Math.PI/2; accel.position.set(0,0.012,-0.625);
      // 파워 팩 (배터리 — 아래)
      const pwr = new THREE.Mesh(box3p(0.060,0.045,0.160),new THREE.MeshStandardMaterial({color:0x0c0c20,roughness:0.4,metalness:0.8}));
      pwr.position.set(0,-0.038,0.020);
      const pwrLed = new THREE.Mesh(box3p(0.008,0.008,0.008),new THREE.MeshStandardMaterial({color:0x00ffaa,emissive:0x00aa66}));
      pwrLed.position.set(0.032,-0.032,0.100);
      // 그립
      const grip = new THREE.Mesh(box3p(0.044,0.102,0.048),rubber(0x060610));
      grip.position.set(0,-0.054,0.065); grip.rotation.x=0.15;
      g.add(body,rL,rR,barrel,accel,pwr,pwrLed,grip);
      tagMuzzle(g,-0.655);
      weaponMeshes['rail'] = g;
    }

    // carbine (SIG MCX style)
    {
      const g = new THREE.Group();
      const recv = new THREE.Mesh(box3p(0.062,0.058,0.390),metal(0x1e1e1e,0.38,0.88));
      recv.position.set(0,0.016,-0.025);
      // 피카티니 레일
      const tRail = new THREE.Mesh(box3p(0.018,0.008,0.310),metal(0x282828));
      tRail.position.set(0,0.050,-0.020);
      for(let i=0;i<5;i++){
        const n=new THREE.Mesh(box3p(0.020,0.010,0.004),metal(0x141414));
        n.position.set(0,0.050,-0.170+i*0.060); g.add(n);
      }
      // 핸드가드 (Keymod)
      const hg = new THREE.Mesh(box3p(0.072,0.058,0.200),metal(0x242424,0.5));
      hg.position.set(0,0.008,-0.190);
      for(let i=0;i<3;i++){
        const ks=new THREE.Mesh(box3p(0.074,0.010,0.016),metal(0x111111));
        ks.position.set(0,-0.004,-0.110-i*0.040); g.add(ks);
      }
      // 총열
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.013,0.290,10),metal(0x222222,0.22,1));
      barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.012,-0.285);
      // 소염기
      const fh = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.013,0.048,6),metal(0x111111,0.2,1));
      fh.rotation.x=Math.PI/2; fh.position.set(0,0.012,-0.454);
      // 그립
      const grip = new THREE.Mesh(box3p(0.046,0.108,0.050),rubber(0x151515));
      grip.position.set(0,-0.060,0.055); grip.rotation.x=0.18;
      // 탄창
      const mag = new THREE.Mesh(box3p(0.036,0.100,0.048),metal(0x1c1c1c,0.5));
      mag.position.set(0,-0.065,-0.022); mag.rotation.x=-0.10;
      // 개머리판 (SBR folding)
      const stk = new THREE.Mesh(box3p(0.052,0.048,0.175),metal(0x1a1a1a));
      stk.position.set(0,0.008,0.188);
      const stkEnd5 = new THREE.Mesh(box3p(0.058,0.058,0.024),rubber(0x0e0e0e));
      stkEnd5.position.set(0,0.008,0.278);
      // 탄창 방출 레버
      const magR = new THREE.Mesh(box3p(0.008,0.014,0.020),metal(0x282828));
      magR.position.set(0.038,-0.008,-0.022);
      g.add(recv,tRail,hg,barrel,fh,grip,mag,stk,stkEnd5,magR);
      tagMuzzle(g,-0.480);
      weaponMeshes['carbine'] = g;
    }

    // rpg (RPG-7)
    {
      const g = new THREE.Group();
      // 발사관 (앞쪽 넓음)
      const frontTube = new THREE.Mesh(new THREE.CylinderGeometry(0.050,0.048,0.380,12),metal(0x3a2e1a,0.65,0.25));
      frontTube.rotation.x=Math.PI/2; frontTube.position.set(0,0,-0.165);
      // 중간 그립 구역 (좁음)
      const midTube = new THREE.Mesh(new THREE.CylinderGeometry(0.042,0.042,0.280,12),metal(0x362a18,0.68,0.2));
      midTube.rotation.x=Math.PI/2; midTube.position.set(0,0,0.100);
      // 뒤쪽 플레어 (역폭발 방지)
      const backFlare = new THREE.Mesh(new THREE.CylinderGeometry(0.065,0.042,0.180,12),metal(0x2e2410,0.7));
      backFlare.rotation.x=Math.PI/2; backFlare.position.set(0,0,0.330);
      // 방아쇠 메커니즘 박스
      const trigBox = new THREE.Mesh(box3p(0.068,0.065,0.150),metal(0x2c2416,0.6));
      trigBox.position.set(0,-0.012,-0.050);
      // 방아쇠 가드 + 레버
      const tgBox = new THREE.Mesh(box3p(0.050,0.010,0.075),metal(0x222222));
      tgBox.position.set(0,-0.045,-0.048);
      const tgLev = new THREE.Mesh(box3p(0.008,0.030,0.012),metal(0x282828));
      tgLev.position.set(0,-0.040,-0.020); tgLev.rotation.x=0.3;
      // 전방 조준기 (비네 사이트)
      const sightF2 = new THREE.Mesh(box3p(0.008,0.048,0.010),metal(0x404040));
      sightF2.position.set(0,0.062,-0.330);
      const sightFT = new THREE.Mesh(box3p(0.022,0.008,0.010),metal(0x404040));
      sightFT.position.set(0,0.086,-0.330);
      // 후방 조준기
      const sightR2 = new THREE.Mesh(box3p(0.025,0.036,0.010),metal(0x383838));
      sightR2.position.set(0,0.058,0.050);
      // 사이트 창 (원형)
      const sightHole = new THREE.Mesh(new THREE.TorusGeometry(0.010,0.003,6,12),metal(0x282828));
      sightHole.position.set(0,0.064,0.050);
      // 그립
      const grip = new THREE.Mesh(box3p(0.052,0.118,0.055),rubber(0x180e06));
      grip.position.set(0,-0.082,-0.035); grip.rotation.x=0.12;
      // 그립 홈 (5개)
      for(let i=0;i<5;i++){
        const gv=new THREE.Mesh(box3p(0.054,0.008,0.025),rubber(0x100a04));
        gv.position.set(0,-0.050-i*0.018,-0.032); gv.rotation.x=0.12; g.add(gv);
      }
      // 어깨 패드 (오른쪽)
      const shPad = new THREE.Mesh(box3p(0.020,0.055,0.100),rubber(0x141010));
      shPad.position.set(0.055,-0.005,0.080);
      // 로켓 탄두
      const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.044,0.200,12),metal(0x2a2a2a,0.38));
      warhead.rotation.x=Math.PI/2; warhead.position.set(0,0,-0.640);
      const warBody = new THREE.Mesh(new THREE.CylinderGeometry(0.044,0.044,0.130,12),metal(0x323232,0.42));
      warBody.rotation.x=Math.PI/2; warBody.position.set(0,0,-0.510);
      // 탄두 핀 (4개)
      for(let i=0;i<4;i++){
        const fin = new THREE.Mesh(box3p(0.002,0.028,0.045),metal(0x2c2c2c));
        fin.position.set(Math.cos(i*Math.PI/2)*0.044,Math.sin(i*Math.PI/2)*0.044,-0.380); g.add(fin);
      }
      g.add(frontTube,midTube,backFlare,trigBox,tgBox,tgLev,sightF2,sightFT,sightR2,sightHole,grip,shPad,warhead,warBody);
      tagMuzzle(g,-0.745);
      weaponMeshes['rpg'] = g;
    }
    // 기본 무기 mesh (m4a1 box fallback) 추가
    gunGroup.add(weaponMeshes['m4a1']);

    // 픽셀 텍스처 적용 대상 메시들
    const bodyMeshes = [body, head, legLMesh, legRMesh, armRMesh, armLMesh];

    return { group, headPivot, legLPivot, legRPivot, armLPivot, armRPivot,
             gunGroup, weaponMeshes,
             _currentWeaponId: 'm4a1', _m4aObjLoaded: false,
             nameplate: null, bodyMeshes, _lastPixelKey: null };
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
    const { group, headPivot, legLPivot, legRPivot, armLPivot, armRPivot, gunGroup, weaponMeshes } = parts;

    const px = info.pos?.[0] ?? 0;
    const py = info.pos?.[1] ?? 0;
    const pz = info.pos?.[2] ?? 0;
    const yaw      = info.yaw       ?? 0;
    const pitch    = info.pitch     ?? 0;
    const moveTime = info.move_time ?? 0;
    const bobAmp   = info.bob_amp   ?? 0;
    const isSliding   = !!info.is_sliding;
    const isAiming    = !!info.is_aiming;
    const isReloading = !!info.is_reloading;
    const reloadProg  = info.reload_progress ?? 0;
    const recoil      = info.recoil   ?? 0;

    // ── 현재 장착 무기 ID 계산 (weapon_slot + loadout) ──
    const weaponSlot = info.weapon_slot ?? 1;
    const loadout    = info.loadout || [];
    // slot 1,2,5 → loadout[0],[1],[2]. slot3(붕대), slot4(수류탄) → 숨김
    let activeWeaponId = loadout[0] || 'm4a1';
    if      (weaponSlot === 1) activeWeaponId = loadout[0] || 'm4a1';
    else if (weaponSlot === 2) activeWeaponId = loadout[1] || 'm4a1';
    else if (weaponSlot === 5) activeWeaponId = loadout[2] || 'pistol';

    // ── 무기 mesh 교체 (무기가 바뀌거나 OBJ 로드 완료 시) ──
    // m4a1 OBJ 로드 완료 시 박스 fallback을 대체
    if (activeWeaponId === 'm4a1' && this._sharedGunObj && !parts._m4aObjLoaded) {
      while (gunGroup.children.length > 0) gunGroup.remove(gunGroup.children[0]);
      gunGroup.add(this._cloneGunForPlayer());
      parts._m4aObjLoaded = true;
      parts._currentWeaponId = null; // 강제 재설정
    }

    if (parts._currentWeaponId !== activeWeaponId) {
      while (gunGroup.children.length > 0) gunGroup.remove(gunGroup.children[0]);
      if (activeWeaponId === 'm4a1' && this._sharedGunObj) {
        gunGroup.add(this._cloneGunForPlayer());
      } else {
        const mesh = weaponMeshes[activeWeaponId] || weaponMeshes['m4a1'];
        if (mesh) gunGroup.add(mesh);
      }
      parts._currentWeaponId = activeWeaponId;
    }

    // slot 4(수류탄), 3(붕대) 일 때 총 숨김
    gunGroup.visible = (weaponSlot !== 4 && weaponSlot !== 3);

    const slideOffset = isSliding ? -0.6 : 0;
    group.position.set(px, py + 0.4 + slideOffset, pz);
    group.rotation.y = -THREE.MathUtils.degToRad(yaw) - Math.PI / 2;

    // 머리 pitch — +pitch
    headPivot.rotation.x = THREE.MathUtils.degToRad(pitch);

    // 다리 스윙
    const swing = isSliding ? 0 : Math.sin(moveTime * 6) * (20 * Math.PI/180) * bobAmp;
    legLPivot.rotation.x = isSliding ? (70*Math.PI/180) :  swing;
    legRPivot.rotation.x = isSliding ?-(70*Math.PI/180) : -swing;

    // 총 pitch — 총 중심점에서 회전 (+pitch)
    const ads = isAiming ? 1 : 0;
    const pitchRad = THREE.MathUtils.degToRad(pitch);

    // ── 장전 모션 ──
    if (isReloading) {
      const p = reloadProg;
      let reloadOffset = 0;
      if (p < 0.4) {
        reloadOffset = (p / 0.4) * (50 * Math.PI/180);
      } else if (p < 0.7) {
        reloadOffset = 50 * Math.PI/180;
      } else {
        reloadOffset = (1 - (p - 0.7) / 0.3) * (50 * Math.PI/180);
      }
      gunGroup.rotation.x = pitchRad + reloadProg * Math.PI * 0.18 - recoil * 0.3;
    } else {
      gunGroup.rotation.x = pitchRad - recoil * 0.3;
    }

    // ── 팔을 총 그립/포어그립에 정확히 붙이기 ──
    // gunGroup 로컬 기준 그립 위치: (0, -0.10, 0.10) — 오른손 그립
    // gunGroup 로컬 기준 포어그립:  (0, -0.05, -0.15) — 왼손 포어그립
    const _gripLocal    = new THREE.Vector3(0,  -0.10,  0.10);
    const _foregrip     = new THREE.Vector3(0,  -0.05, -0.15);

    // gunGroup 월드 행렬 업데이트 후 그립 월드 좌표 계산
    gunGroup.updateMatrixWorld(true);
    const gripWorld     = _gripLocal.clone().applyMatrix4(gunGroup.matrixWorld);
    const foregrip      = _foregrip.clone().applyMatrix4(gunGroup.matrixWorld);

    // 오른팔: pivot 월드 좌표 → 그립까지 방향 벡터 → rotation 역산
    // armRPivot 위치는 group 로컬 (0.45, 1.4, 0.05)
    group.updateMatrixWorld(true);
    const armRWorld = new THREE.Vector3(0.45, 1.4, 0.05).applyMatrix4(group.matrixWorld);
    const armLWorld = new THREE.Vector3(-0.45, 1.4, 0.05).applyMatrix4(group.matrixWorld);

    // 팔 길이
    const ARM_R_LEN = 0.6;
    const ARM_L_LEN = 0.7;

    // pivot → 그립 방향으로 팔을 회전시키는 헬퍼
    // armPivot은 group의 자식 → group 로컬 공간에서 계산
    const aimArm = (pivot, gripW, pivotW, armLen) => {
      // group 로컬 공간으로 변환
      const groupMatInv = new THREE.Matrix4().copy(group.matrixWorld).invert();
      const gripLocal  = gripW.clone().applyMatrix4(groupMatInv);
      const pivotLocal = pivotW.clone().applyMatrix4(groupMatInv);

      // pivot → grip 방향 벡터
      const dir = new THREE.Vector3().subVectors(gripLocal, pivotLocal).normalize();

      // 팔의 기본 방향은 pivot 로컬 -Y (아래)
      // Three.js: rotation.x = 앞으로 기울이는 각도
      // dir을 pivot 로컬로 변환해서 각도 추출
      // pivot.rotation.y는 건드리지 않음 (z축 회전으로 옆 방향 처리)
      const rx = Math.atan2(-dir.z, -dir.y); // 앞뒤 기울기
      const rz = Math.atan2( dir.x, -dir.y); // 옆 기울기

      pivot.rotation.x = rx;
      pivot.rotation.z = rz;
    };

    aimArm(armRPivot, gripWorld,    armRWorld, ARM_R_LEN);
    aimArm(armLPivot, foregrip,     armLWorld, ARM_L_LEN);

    // 장전 시 왼팔만 추가 모션
    if (isReloading) {
      const p = reloadProg;
      if (p >= 0.4 && p < 0.7) {
        armLPivot.rotation.x += THREE.MathUtils.degToRad(30 * Math.sin((p - 0.4) / 0.3 * Math.PI));
        armLPivot.rotation.z -= THREE.MathUtils.degToRad(20 * Math.sin((p - 0.4) / 0.3 * Math.PI));
      }
    }

    // gunGroup은 group 직접 자식 — 중심점이 총 중앙, pitch는 gunGroup에서 처리

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
    const geo  = new THREE.SphereGeometry(0.04, 6, 6);
    const mat  = new THREE.MeshBasicMaterial({ color:0x999999, transparent:true, opacity:0.55 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.particles.push({ mesh, life:1, baseSize:0.04,
      vel: new THREE.Vector3((Math.random()-0.5)*0.04, Math.random()*0.025+0.012, (Math.random()-0.5)*0.04),
      type: 'smoke_generic' });
  }

  // ── 고품질 총구 불꽃 + 연기 이펙트 ──
  spawnMuzzleFlash(position, front, strong = false) {

    // ① 총구 위치 (총열 끝)
    const muzzlePos = position.clone().addScaledVector(front, strong ? 1.0 : 0.75);

    // ② 코어 섬광 (밝은 흰색-노랑)
    {
      const group = new THREE.Group();
      group.position.copy(muzzlePos);

      const coreR   = strong ? 0.20 : 0.12;
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xfffce8, transparent:true, opacity:1.0, depthWrite:false });
      const core    = new THREE.Mesh(new THREE.SphereGeometry(coreR, 10, 10), coreMat);
      group.add(core);

      // 방사형 스트릭 (4방향)
      const streakMat = new THREE.MeshBasicMaterial({ color: strong ? 0xffee88 : 0xffdd55, transparent:true, opacity:0.9, depthWrite:false });
      const streakLen  = strong ? 2.2 : 1.1;
      const streakR    = strong ? 0.055 : 0.030;
      // 정면 스트릭 (총구 방향)
      const frontStreak = new THREE.Mesh(new THREE.CylinderGeometry(streakR*0.5, streakR, streakLen, 8), streakMat.clone());
      frontStreak.rotation.z = Math.PI/2;
      frontStreak.position.set(streakLen*0.42, 0, 0);
      group.add(frontStreak);
      // 십자 스트릭들
      for (let a = 0; a < 4; a++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(streakR*0.3, streakR*0.5, streakLen*0.55, 6), streakMat.clone());
        s.rotation.z = Math.PI/2;
        const ang = (a / 4) * Math.PI * 2 + Math.PI/4;
        s.position.set(Math.cos(ang)*streakLen*0.22, Math.sin(ang)*streakLen*0.22, 0);
        s.rotation.x = ang;
        group.add(s);
      }

      group.lookAt(muzzlePos.clone().add(front));
      this.scene.add(group);
      this.particles.push({ mesh:group, life: strong ? 0.18 : 0.10, type:'muzzle', baseSize:1 });
    }

    // ③ 불꽃 파티클 (2~4개, 총구 앞쪽으로 퍼짐)
    const fireCount = strong ? 5 : 2;
    for (let i = 0; i < fireCount; i++) {
      const r   = 0.04 + Math.random() * (strong ? 0.10 : 0.06);
      const geo = new THREE.SphereGeometry(r, 7, 7);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.06 + Math.random()*0.05, 1.0, 0.55),
        transparent:true, opacity:0.92, depthWrite:false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(muzzlePos);
      const spread = 0.06;
      const vel = front.clone().multiplyScalar(0.06 + Math.random()*0.04).add(
        new THREE.Vector3((Math.random()-0.5)*spread, (Math.random()-0.5)*spread*0.5, (Math.random()-0.5)*spread)
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, life:1, maxLife: strong ? 0.22 : 0.14, type:'muzzle_fire', vel, baseSize:r });
    }

    // ④ 연기 (총구에서 피어오름 — 3~6개 구체)
    const smokeCount = strong ? 6 : 3;
    for (let i = 0; i < smokeCount; i++) {
      const r   = 0.05 + Math.random() * 0.08;
      const col = 0x606060 + Math.floor(Math.random() * 0x303030);
      const geo = new THREE.SphereGeometry(r, 7, 7);
      const mat = new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:0.0, depthWrite:false });
      const mesh = new THREE.Mesh(geo, mat);
      // 연기는 총구에서 조금 뒤쪽에서 시작
      mesh.position.copy(muzzlePos).addScaledVector(front, -0.05 + Math.random()*0.08);
      const vel = new THREE.Vector3(
        (Math.random()-0.5)*0.02,
        0.018 + Math.random()*0.025,
        (Math.random()-0.5)*0.02
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, life:1, maxLife: 0.9 + Math.random()*0.6, type:'muzzle_smoke', vel, baseSize:r, delay: i*0.03 });
    }

    // ⑤ 탄피 배출 파티클 (작은 황동색 원통)
    {
      const geo = new THREE.CylinderGeometry(0.008, 0.008, 0.024, 8);
      const mat = new THREE.MeshBasicMaterial({ color:0xcc9933 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(muzzlePos).addScaledVector(front, -0.35);
      mesh.position.x += 0.06;
      const vel = new THREE.Vector3(
        0.04 + Math.random()*0.03,
        0.05 + Math.random()*0.03,
        (Math.random()-0.5)*0.02
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, life:1, maxLife: 0.6, type:'shell_case', vel, baseSize:1 });
    }
  }

  // ── 탄두 트레이서 (총알이 날아가는 빛줄기) ──
  spawnBulletTracer(startPos, direction, weaponId = 'm4a1') {
    const isEnergy = weaponId === 'rail' || weaponId === 'burst';
    const isShotgun = weaponId === 'shotgun';
    const tracerColor = isEnergy ? 0x44aaff : (isShotgun ? 0xffdd88 : 0xffffcc);
    const tracerLen   = isEnergy ? 1.2 : (isShotgun ? 0.4 : 0.7);
    const tracerR     = isEnergy ? 0.014 : 0.008;
    const tracerSpeed = isEnergy ? 0.70 : 0.55;

    const geo = new THREE.CylinderGeometry(tracerR*0.3, tracerR, tracerLen, 6);
    const mat = new THREE.MeshBasicMaterial({ color:tracerColor, transparent:true, opacity:0.85, depthWrite:false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(startPos);

    // 방향으로 회전
    const axis   = new THREE.Vector3(0,1,0);
    const target = direction.clone().normalize();
    const quat   = new THREE.Quaternion().setFromUnitVectors(axis, target);
    mesh.quaternion.copy(quat);

    this.scene.add(mesh);
    this.particles.push({
      mesh, life:1, maxLife: 0.35,
      type: 'tracer',
      vel: direction.clone().normalize().multiplyScalar(tracerSpeed),
      baseSize:1
    });

    // 에너지 무기 전용: 보조 글로우
    if (isEnergy) {
      const geo2 = new THREE.CylinderGeometry(tracerR*1.5, tracerR*2, tracerLen*1.2, 6);
      const mat2 = new THREE.MeshBasicMaterial({ color:0x0066ff, transparent:true, opacity:0.30, depthWrite:false });
      const glow = new THREE.Mesh(geo2, mat2);
      glow.position.copy(startPos);
      glow.quaternion.copy(quat);
      this.scene.add(glow);
      this.particles.push({ mesh:glow, life:1, maxLife:0.35, type:'tracer', vel: direction.clone().normalize().multiplyScalar(tracerSpeed), baseSize:1 });
    }
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
      // 불꽃 (총구 fire)
      if (p.type === 'muzzle_fire') {
        p.vel.y += 0.003;
        p.mesh.position.addScaledVector(p.vel, 60 * dt);
        const s = p.baseSize * (0.5 + p.life * 1.2);
        p.mesh.scale.setScalar(s / p.baseSize);
        p.mesh.material.opacity = p.life * 0.9;
        p.mesh.material.color.setHSL(0.08 * p.life, 1, 0.5 + p.life * 0.15);
        return true;
      }
      // 연기 (총구 smoke)
      if (p.type === 'muzzle_smoke') {
        p.vel.y += 0.0008;
        p.mesh.position.addScaledVector(p.vel, 60 * dt);
        const age  = 1 - p.life;
        const s    = p.baseSize * (1 + age * 6.0);
        p.mesh.scale.setScalar(s / p.baseSize);
        // 처음엔 페이드인, 후반엔 페이드아웃
        p.mesh.material.opacity = age < 0.15
          ? (age / 0.15) * 0.38
          : p.life * 0.38;
        return true;
      }
      // 탄피
      if (p.type === 'shell_case') {
        p.vel.y -= 0.015;
        p.vel.x *= 0.94;
        p.mesh.position.addScaledVector(p.vel, 60 * dt);
        p.mesh.rotation.x += 0.35;
        p.mesh.rotation.z += 0.20;
        p.mesh.material.opacity = p.life > 0.3 ? 1.0 : p.life / 0.3;
        return true;
      }
      // 탄두 트레이서
      if (p.type === 'tracer') {
        p.mesh.position.addScaledVector(p.vel, 60 * dt);
        p.mesh.material.opacity = p.life * 0.85;
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
    // gunGroup은 이제 headPivot 자식, position은 외부에서 팔 끝으로 설정됨
    // OBJ: barrel runs +Z → Y=PI 회전으로 총구가 -Z(앞)을 향하게
    // center.x 보정으로 좌우 중앙 맞춤
    g.position.set(-c.x * s, -c.y * s, -c.z * s);
    g.rotation.set(0, Math.PI, 0);
    return g;
  }

  getBoxes()     { return this.boxMeshes; }
  getTexPlayer() { return this.texPlayer; }
  getTexWeapon() { return this.texWeapon; }
}
