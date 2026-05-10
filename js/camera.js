// camera.js - 1인칭/3인칭 카메라 (roll 뒤집힘 버그 수정, 워킹밥 정확 구현)

import * as THREE from 'three';

export class CameraController {
  constructor(threeCamera) {
    this.camera = threeCamera;

    this.yaw   = -90.0;
    this.pitch =   0.0;

    this.cameraDistance = 4.0;
    this.minDist = 0.0;
    this.maxDist = 8.0;
    this.isFirstPerson = false;

    this.slideDrop = 0;

    // 재사용 벡터
    this._front   = new THREE.Vector3();
    this._right   = new THREE.Vector3();
    this._headPos = new THREE.Vector3();
    this._camPos  = new THREE.Vector3();
    this._target  = new THREE.Vector3();
    this._up      = new THREE.Vector3(0,1,0);

    // roll용 quaternion (lookAt 이후 추가 회전)
    this._qRoll = new THREE.Quaternion();
  }

  onMouseMove(dx, dy, isAiming, scopeProgress = 0) {
    const scopeSens = scopeProgress > 0.5 ? 0.15 : 1.0;
    const sens = 0.08 * (isAiming ? 0.5 : 1.0) * scopeSens;
    this.yaw   += dx * sens;
    this.pitch -= dy * sens;
    this.pitch  = Math.max(-89, Math.min(89, this.pitch));
  }

  setFovFromScope(scopeProgress, speedPulse = 0) {
    const baseFov   = 60 + Math.min(8, speedPulse * 120);
    const sniperFov = 15;  // 저격 최대 줌
    const fov = baseFov + (sniperFov - baseFov) * scopeProgress;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  onWheel(delta) {
    this.cameraDistance = Math.max(this.minDist,
      Math.min(this.maxDist, this.cameraDistance - delta * 0.5));
    this.isFirstPerson = this.cameraDistance <= 0.5;
  }

  /**
   * 매 프레임 카메라 갱신
   * @param {THREE.Vector3} playerPos
   * @param {boolean} isSliding
   * @param {number} bobAmp    - 0~1 보간된 bob 강도
   * @param {number} moveTime  - 누적 이동 시간 (bob 주기 소스)
   * @param {boolean} isJumping
   * @param {number} currentRoll - 도 단위 roll (측면 이동 틸트 + 반동)
   */
  update(playerPos, isSliding, bobAmp, moveTime, isJumping, currentRoll) {
    const yawRad   = THREE.MathUtils.degToRad(this.yaw);
    const pitchRad = THREE.MathUtils.degToRad(this.pitch);

    // ── 전방·오른쪽 벡터 ──
    this._front.set(
      Math.cos(yawRad) * Math.cos(pitchRad),
      Math.sin(pitchRad),
      Math.sin(yawRad) * Math.cos(pitchRad)
    );
    this._right.set(-Math.sin(yawRad), 0, Math.cos(yawRad));

    // ── 머리 위치 ──
    const HEAD_HEIGHT = 1.7;
    this.slideDrop += ((isSliding ? -0.6 : 0) - this.slideDrop) * 0.2;

    this._headPos.set(
      playerPos.x,
      playerPos.y + HEAD_HEIGHT + this.slideDrop,
      playerPos.z
    );

    // ── 워킹 밥 (1인칭 뷰 흔들림) ──
    // Python: view_bob_offset = sin(move_time*7)*0.06*bob_amp
    if (!isJumping && !isSliding) {
      const viewBob = Math.sin(moveTime * 7) * 0.06 * bobAmp;
      this._headPos.y += viewBob;
    }

    // ── 카메라 위치 / 타겟 ──
    const dist = this.cameraDistance;
    if (this.isFirstPerson) {
      this._camPos.copy(this._headPos);
      this._target.copy(this._headPos).addScaledVector(this._front, 1);
    } else {
      const f = Math.max(0, Math.min(1, (dist - 0.5) / 2.0));
      this._camPos.copy(this._headPos)
        .addScaledVector(this._front, -dist)
        .addScaledVector(this._right, -0.8 * f);
      this._camPos.y += 0.3 * f;
      this._target.copy(this._headPos).addScaledVector(this._front, 100);
    }

    // ── lookAt (roll 없이 먼저 회전 확정) ──
    this.camera.position.copy(this._camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this._target);
    this.camera.updateMatrixWorld();

    // ── Roll 적용 ──
    // lookAt 후 camera의 local Z축(뷰 방향)을 기준으로 추가 회전
    // → 전방 벡터를 축으로 사용하면 lookAt 이후에도 뒤집힘이 없음
    if (Math.abs(currentRoll) > 0.001) {
      const rollRad = THREE.MathUtils.degToRad(currentRoll);
      // 카메라 로컬 앞 방향 = 전방 벡터의 반대 (-Z_local)
      // 실제로는 world-space front 벡터를 축으로 사용
      this._qRoll.setFromAxisAngle(this._front.clone().normalize(), rollRad);
      this.camera.quaternion.premultiply(this._qRoll);
    }
  }

  getFront()   { return this._front.clone(); }
  getRight()   { return this._right.clone(); }
  getHeadPos() { return this._headPos.clone(); }
  getCamPos()  { return this._camPos.clone(); }
}
