// grenade.js - 수류탄 물리 + 폭발 시스템

import * as THREE from 'three';

export class GrenadeSystem {
  constructor(scene, boxes) {
    this.scene    = scene;
    this.boxes    = boxes;
    this.grenades = [];   // 활성 수류탄 목록

    // 폭발 이펙트 풀
    this._explosionMeshes = [];

    // 콜백
    this.onExplode = null; // (position, radius, maxDamage) => void
  }

  // ── 수류탄 투척 ──
  // throwPower: 0~1 (좌클릭 홀드 시간에 비례)
  throw(originPos, front, pitch, throwPower) {
    const GRENADE_GRAVITY = -0.018;
    const MIN_SPEED = 0.15;
    const MAX_SPEED = 0.55;
    const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * throwPower;

    // 투척 방향: 카메라 전방 + 위쪽 성분
    const pitchRad = THREE.MathUtils.degToRad(pitch + 15); // 약간 위로 보정
    const dir = new THREE.Vector3(
      front.x * Math.cos(pitchRad),
      Math.sin(pitchRad),
      front.z * Math.cos(pitchRad)
    ).normalize();

    // 수류탄 메시 (작은 구)
    const geo  = new THREE.SphereGeometry(0.08, 6, 6);
    const mat  = new THREE.MeshLambertMaterial({ color: 0x2d4a1e });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;

    // 발사 위치: 카메라 눈높이에서 약간 앞
    const spawnPos = originPos.clone();
    spawnPos.y += 1.5;
    spawnPos.addScaledVector(front, 0.5);
    mesh.position.copy(spawnPos);
    this.scene.add(mesh);

    const grenade = {
      mesh,
      vel:      dir.clone().multiplyScalar(speed),
      gravity:  GRENADE_GRAVITY,
      timer:    180,      // 3초 = 60fps × 3
      bounces:  0,
      maxBounce: 4,
      exploded: false,
    };

    this.grenades.push(grenade);
    return grenade;
  }

  // ── 매 프레임 업데이트 ──
  update() {
    const toRemove = [];

    for (const g of this.grenades) {
      if (g.exploded) { toRemove.push(g); continue; }

      // 중력
      g.vel.y += g.gravity;

      // 다음 위치 계산
      const nextPos = g.mesh.position.clone().add(g.vel);

      // ── 박스 충돌 (벽/바닥 반사) ──
      let hit = false;
      for (const b of this.boxes) {
        const [bx,by,bz] = b.pos;
        const [sx,sy,sz] = b.size;
        const R = 0.08; // 수류탄 반경

        const inX = nextPos.x > bx-sx-R && nextPos.x < bx+sx+R;
        const inY = nextPos.y > by-sy-R && nextPos.y < by+sy+R;
        const inZ = nextPos.z > bz-sz-R && nextPos.z < bz+sz+R;

        if (inX && inY && inZ) {
          // 현재 위치 기준으로 어느 면에 충돌했는지 판단
          const cur = g.mesh.position;
          const wasInX = cur.x > bx-sx-R && cur.x < bx+sx+R;
          const wasInY = cur.y > by-sy-R && cur.y < by+sy+R;
          const wasInZ = cur.z > bz-sz-R && cur.z < bz+sz+R;

          if (!wasInX && wasInY && wasInZ) g.vel.x *= -0.45; // X면 반사
          if (wasInX && !wasInY && wasInZ) g.vel.y *= -0.45; // Y면 반사
          if (wasInX && wasInY && !wasInZ) g.vel.z *= -0.45; // Z면 반사

          // 마찰
          g.vel.x *= 0.82;
          g.vel.z *= 0.82;
          g.bounces++;
          hit = true;
          break;
        }
      }

      if (!hit) {
        g.mesh.position.copy(nextPos);
      }

      // 수류탄 회전 (리얼감)
      g.mesh.rotation.x += g.vel.length() * 0.5;
      g.mesh.rotation.z += g.vel.length() * 0.3;

      // 타이머 감소
      g.timer--;

      // 타이머 만료 → 폭발
      if (g.timer <= 0) {
        this._explode(g);
        toRemove.push(g);
      }
    }

    // 폭발 이펙트 업데이트
    this._updateExplosions();

    // 폭발한 수류탄 제거
    for (const g of toRemove) {
      const idx = this.grenades.indexOf(g);
      if (idx !== -1) this.grenades.splice(idx, 1);
      if (!g.exploded) this.scene.remove(g.mesh);
    }
  }

  // ── 폭발 ──
  _explode(g) {
    g.exploded = true;
    const pos = g.mesh.position.clone();
    this.scene.remove(g.mesh);

    // 폭발 콜백 (main.js에서 피해 계산)
    if (this.onExplode) this.onExplode(pos, 8.0, 80);

    // 폭발 이펙트 생성
    this._spawnExplosion(pos);
  }

  // ── 폭발 이펙트 ──
  _spawnExplosion(pos) {
    const particles = [];

    // 중앙 섬광구
    const flashGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 1 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos);
    this.scene.add(flash);
    particles.push({ mesh: flash, life: 1, maxLife: 1, type: 'flash', scale: 0.3 });

    // 화염구 (여러 개)
    for (let i = 0; i < 12; i++) {
      const size = 0.15 + Math.random() * 0.35;
      const geo  = new THREE.SphereGeometry(size, 6, 6);
      const mat  = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.05 + Math.random()*0.05, 1, 0.5 + Math.random()*0.3),
        transparent: true, opacity: 0.9
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      const vel = new THREE.Vector3(
        (Math.random()-0.5)*0.25,
        Math.random()*0.2 + 0.05,
        (Math.random()-0.5)*0.25
      );
      this.scene.add(mesh);
      particles.push({ mesh, vel, life: 1, maxLife: 1, type: 'fire', scale: size });
    }

    // 연기 파티클
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.SphereGeometry(0.2 + Math.random()*0.2, 5, 5);
      const mat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos).addScaledVector(
        new THREE.Vector3(Math.random()-0.5, Math.random(), Math.random()-0.5).normalize(),
        Math.random() * 1.5
      );
      const vel = new THREE.Vector3(
        (Math.random()-0.5)*0.04,
        0.02 + Math.random()*0.03,
        (Math.random()-0.5)*0.04
      );
      this.scene.add(mesh);
      particles.push({ mesh, vel, life: 1, maxLife: 2.5, type: 'smoke', scale: 0.2+Math.random()*0.2 });
    }

    // 파편
    for (let i = 0; i < 16; i++) {
      const geo  = new THREE.BoxGeometry(0.04, 0.04, 0.1);
      const mat  = new THREE.MeshBasicMaterial({ color: 0x555555 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      const vel = new THREE.Vector3(
        (Math.random()-0.5)*0.4,
        Math.random()*0.35 + 0.1,
        (Math.random()-0.5)*0.4
      );
      this.scene.add(mesh);
      particles.push({ mesh, vel, life: 1, maxLife: 0.8, type: 'debris' });
    }

    // 충격파 링
    const ringGeo = new THREE.TorusGeometry(0.1, 0.04, 6, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
    const ring    = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    particles.push({ mesh: ring, life: 1, maxLife: 0.5, type: 'ring' });

    this._explosionMeshes.push(...particles);
  }

  _updateExplosions() {
    const toRemove = [];
    for (const p of this._explosionMeshes) {
      p.life -= 1/60 / p.maxLife;
      if (p.life <= 0) { this.scene.remove(p.mesh); toRemove.push(p); continue; }

      if (p.type === 'flash') {
        const s = 1 + (1 - p.life) * 8;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = p.life;
      } else if (p.type === 'fire') {
        p.vel.y -= 0.003;
        p.mesh.position.add(p.vel);
        const s = p.life * 1.5;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = p.life * 0.9;
        p.mesh.material.color.setHSL(0.05 * p.life, 1, 0.5);
      } else if (p.type === 'smoke') {
        p.mesh.position.add(p.vel);
        p.vel.y += 0.001;
        const s = p.scale * (1 + (1-p.life) * 3);
        p.mesh.scale.setScalar(s / p.scale);
        p.mesh.material.opacity = p.life * 0.5;
      } else if (p.type === 'debris') {
        p.vel.y -= 0.012;
        p.mesh.position.add(p.vel);
        p.mesh.rotation.x += 0.2;
        p.mesh.rotation.z += 0.15;
        p.mesh.material.opacity = p.life;
      } else if (p.type === 'ring') {
        const s = 1 + (1-p.life) * 12;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = p.life * 0.7;
      }
    }
    for (const p of toRemove) {
      const idx = this._explosionMeshes.indexOf(p);
      if (idx !== -1) this._explosionMeshes.splice(idx, 1);
    }
  }

  // ── 남은 수류탄 개수 ──
  get count() { return this._stockCount ?? 3; }
}
