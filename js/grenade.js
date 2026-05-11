// grenade.js - Grenade physics + explosion system

import * as THREE from 'three';

export class GrenadeSystem {
  constructor(scene, boxes) {
    this.scene    = scene;
    this.boxes    = boxes;
    this.grenades = [];   // active grenades

    // explosion effect pool
    this._explosionMeshes = [];

    // callbacks
    this.onExplode = null; // (position, radius, maxDamage) => void
    this.getContactTargets = null;
  }

  // ── Throw grenade ──
  // throwPower: 0~1 (proportional to left-click hold time)
  throw(originPos, front, pitch, throwPower) {
    const GRENADE_GRAVITY = -0.018;
    const MIN_SPEED = 0.15;
    const MAX_SPEED = 0.55;
    const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * throwPower;

    const pitchRad = THREE.MathUtils.degToRad(pitch + 15);
    const dir = new THREE.Vector3(
      front.x * Math.cos(pitchRad),
      Math.sin(pitchRad),
      front.z * Math.cos(pitchRad)
    ).normalize();

    const geo  = new THREE.SphereGeometry(0.08, 6, 6);
    const mat  = new THREE.MeshLambertMaterial({ color: 0x2d4a1e });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;

    const spawnPos = originPos.clone();
    spawnPos.y += 1.5;
    spawnPos.addScaledVector(front, 0.5);
    mesh.position.copy(spawnPos);
    this.scene.add(mesh);

    const grenade = {
      mesh,
      vel:      dir.clone().multiplyScalar(speed),
      gravity:  GRENADE_GRAVITY,
      timer:    3.0,     // 3 seconds (dt-based)
      age:      0,       // seconds
      bounces:  0,
      maxBounce: 4,
      exploded: false,
    };

    this.grenades.push(grenade);
    return grenade;
  }

  // ── Update every frame (dt in seconds) ──
  update(dt = 1/60) {
    const scale = dt * 60; // normalise to 60fps
    const toRemove = [];

    for (const g of this.grenades) {
      if (g.exploded) { toRemove.push(g); continue; }

      // gravity
      g.vel.y += g.gravity * scale;

      // next position
      const nextPos = g.mesh.position.clone().addScaledVector(g.vel, scale);

      // ── box collision (wall/floor bounce) ──
      let hit = false;
      for (const b of this.boxes) {
        const [bx,by,bz] = b.pos;
        const [sx,sy,sz] = b.size;
        const R = 0.08;

        const inX = nextPos.x > bx-sx-R && nextPos.x < bx+sx+R;
        const inY = nextPos.y > by-sy-R && nextPos.y < by+sy+R;
        const inZ = nextPos.z > bz-sz-R && nextPos.z < bz+sz+R;

        if (inX && inY && inZ) {
          const cur = g.mesh.position;
          const wasInX = cur.x > bx-sx-R && cur.x < bx+sx+R;
          const wasInY = cur.y > by-sy-R && cur.y < by+sy+R;
          const wasInZ = cur.z > bz-sz-R && cur.z < bz+sz+R;

          if (!wasInX && wasInY && wasInZ) g.vel.x *= -0.45;
          if (wasInX && !wasInY && wasInZ) g.vel.y *= -0.45;
          if (wasInX && wasInY && !wasInZ) g.vel.z *= -0.45;

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

      // rotation
      g.mesh.rotation.x += g.vel.length() * 0.5 * scale;
      g.mesh.rotation.z += g.vel.length() * 0.3 * scale;

      g.age += dt;
      if (g.age > 0.13 && this._touchesPlayer(g)) {
        this._explode(g, { contact: true });
        toRemove.push(g);
        continue;
      }

      // dt-based timer countdown
      g.timer -= dt;

      if (g.timer <= 0) {
        this._explode(g, { contact: false });
        toRemove.push(g);
      }
    }

    // update explosion effects
    this._updateExplosions(dt);

    for (const g of toRemove) {
      const idx = this.grenades.indexOf(g);
      if (idx !== -1) this.grenades.splice(idx, 1);
      if (!g.exploded) this.scene.remove(g.mesh);
    }
  }

  // ── Explode ──
  _explode(g, meta = {}) {
    g.exploded = true;
    const pos = g.mesh.position.clone();
    this.scene.remove(g.mesh);
    if (this.onExplode) this.onExplode(pos, 8.0, 80, meta);
    this._spawnExplosion(pos);
  }

  _touchesPlayer(g) {
    if (!this.getContactTargets) return false;
    const targets = this.getContactTargets() || [];
    for (const target of targets) {
      const center = target.pos.clone();
      center.y += target.height ? target.height * 0.5 : 0.9;
      if (center.distanceTo(g.mesh.position) <= (target.radius || 0.48)) return true;
    }
    return false;
  }

  // ── Explosion effect ──
  _spawnExplosion(pos) {
    const particles = [];

    const flashGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 1 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos);
    this.scene.add(flash);
    particles.push({ mesh: flash, life: 1, maxLife: 1, type: 'flash', scale: 0.3 });

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

    const ringGeo = new THREE.TorusGeometry(0.1, 0.04, 6, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
    const ring    = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    particles.push({ mesh: ring, life: 1, maxLife: 0.5, type: 'ring' });

    this._explosionMeshes.push(...particles);
  }

  _updateExplosions(dt = 1/60) {
    const toRemove = [];
    for (const p of this._explosionMeshes) {
      p.life -= dt / p.maxLife;
      if (p.life <= 0) { this.scene.remove(p.mesh); toRemove.push(p); continue; }

      const scale = dt * 60;
      if (p.type === 'flash') {
        const s = 1 + (1 - p.life) * 8;
        p.mesh.scale.setScalar(s);
        p.mesh.material.opacity = p.life;
      } else if (p.type === 'fire') {
        p.vel.y -= 0.003 * scale;
        p.mesh.position.addScaledVector(p.vel, scale);
        p.mesh.scale.setScalar(p.life * 1.5);
        p.mesh.material.opacity = p.life * 0.9;
        p.mesh.material.color.setHSL(0.05 * p.life, 1, 0.5);
      } else if (p.type === 'smoke') {
        p.mesh.position.addScaledVector(p.vel, scale);
        p.vel.y += 0.001 * scale;
        const s = p.scale * (1 + (1-p.life) * 3);
        p.mesh.scale.setScalar(s / p.scale);
        p.mesh.material.opacity = p.life * 0.5;
      } else if (p.type === 'debris') {
        p.vel.y -= 0.012 * scale;
        p.mesh.position.addScaledVector(p.vel, scale);
        p.mesh.rotation.x += 0.2 * scale;
        p.mesh.rotation.z += 0.15 * scale;
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

  get count() { return this._stockCount ?? 3; }
}
