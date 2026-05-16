// mobile.js - 모바일 터치 컨트롤 시스템

export const isMobile = (() => {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
})();

export class MobileControls {
  constructor(camCtrl, player) {
    this.camCtrl = camCtrl;
    this.player  = player;

    this._keys  = player.keys;
    this._mouse = player.mouse;

    this._joystick = { active: false, touchId: null, startX: 0, startY: 0, dx: 0, dy: 0 };
    this._look     = { active: false, touchId: null, lastX: 0, lastY: 0 };
    this._active   = false;
    this._aimLocked = false; // 조준 토글 상태
  }

  setActive(v) { this._active = v; }

  buildUI() {
    if (!isMobile) return;

    const c = document.createElement('div');
    c.id = 'mobile-controls';
    c.style.display = 'none';
    c.innerHTML = `
      <div id="mob-look-zone"></div>

      <div id="mob-left">
        <div id="mob-joystick-zone">
          <div id="mob-joystick-base">
            <div id="mob-joystick-knob"></div>
          </div>
        </div>
      </div>

      <div id="mob-right">
        <div id="mob-right-btns">
          <div id="mob-grid">
            <button class="mob-btn mob-fire" id="mob-fire">&#x1F534;<span>FIRE</span></button>
            <button class="mob-btn mob-dash" id="mob-dash">&#x26A1;<span>DASH</span></button>
            <button class="mob-btn mob-aim"  id="mob-aim" >&#x25CE;<span>AIM</span></button>
            <button class="mob-btn mob-rel"  id="mob-reload">&#x21BA;<span>RELOAD</span></button>
          </div>
          <button class="mob-btn mob-jump" id="mob-jump">&#x25B2;<span>JUMP</span></button>
        </div>
      </div>

      <button id="mob-resupply">&#x1F4E6; RESUPPLY</button>

      <div id="mob-weapon-bar">
        <button class="mob-slot" data-slot="1" id="mob-slot-1">1</button>
        <button class="mob-slot" data-slot="2" id="mob-slot-2">2</button>
        <button class="mob-slot" data-slot="5" id="mob-slot-5">3</button>
        <button class="mob-slot" data-slot="4" id="mob-slot-4">&#x1F4A3;</button>
        <button class="mob-slot" data-slot="3" id="mob-slot-3">&#x1FA79;</button>
      </div>
    `;
    document.body.appendChild(c);
    this._injectStyles();
    this._bindEvents();
  }

  _injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #mobile-controls {
        position: fixed; inset: 0; z-index: 200;
        pointer-events: none;
        display: flex;
        user-select: none; -webkit-user-select: none;
      }
      #mob-look-zone {
        position: absolute; inset: 0;
        pointer-events: auto;
        touch-action: none;
        z-index: 0;
      }
      #mob-left, #mob-right {
        flex: 1; position: relative;
        display: flex; flex-direction: column;
        pointer-events: none;
        z-index: 2;
      }
      #mob-joystick-zone {
        flex: 1;
        display: flex; align-items: flex-end; justify-content: flex-start;
        padding: 0 0 90px 24px;
        pointer-events: auto;
        touch-action: none;
      }
      #mob-joystick-base {
        width: 110px; height: 110px; border-radius: 50%;
        background: rgba(0,255,224,0.08);
        border: 2px solid rgba(0,255,224,0.25);
        position: relative;
        display: flex; align-items: center; justify-content: center;
      }
      #mob-joystick-knob {
        width: 44px; height: 44px; border-radius: 50%;
        background: rgba(0,255,224,0.35);
        border: 2px solid rgba(0,255,224,0.7);
        position: absolute;
        box-shadow: 0 0 12px rgba(0,255,224,0.4);
        transition: transform 0.05s;
      }
      #mob-right-btns {
        position: absolute;
        bottom: 20px; right: 16px;
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        gap: 8px;
        pointer-events: none;
      }
      #mob-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        gap: 8px;
        pointer-events: auto;
      }
      .mob-btn {
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 2px;
        font-family: 'Orbitron', monospace;
        font-size: 14px; line-height: 1;
        border-radius: 50%;
        width: 44px; height: 44px;
        border: 2px solid rgba(0,255,224,0.35);
        background: rgba(0,0,0,0.5);
        color: #00ffe0;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: none;
        pointer-events: auto;
        box-shadow: 0 0 10px rgba(0,255,224,0.15);
      }
      .mob-btn span {
        font-size: 6px; letter-spacing: 1px;
        opacity: 0.65;
        font-family: 'Share Tech Mono', monospace;
      }
      .mob-btn:active, .mob-btn.pressed {
        background: rgba(0,255,224,0.22);
        box-shadow: 0 0 18px rgba(0,255,224,0.4);
      }
      .mob-fire {
        border-color: rgba(255,80,80,0.6);
        color: #ff5050;
        box-shadow: 0 0 12px rgba(255,80,80,0.2);
      }
      .mob-fire.pressed { background: rgba(255,80,80,0.25); }
      .mob-aim {
        border-color: rgba(255,204,0,0.5);
        color: #ffcc00;
      }
      .mob-aim.pressed { background: rgba(255,204,0,0.2); }
      .mob-jump {
        width: 72px; height: 72px;
        font-size: 24px;
        border-color: rgba(0,255,224,0.7);
        border-width: 2px;
        background: rgba(0,20,15,0.65);
        box-shadow: 0 0 20px rgba(0,255,224,0.3);
        pointer-events: auto;
        align-self: flex-end;
      }
      .mob-jump.pressed {
        background: rgba(0,255,224,0.25);
        box-shadow: 0 0 32px rgba(0,255,224,0.6);
      }
      #mob-weapon-bar {
        position: absolute; bottom: 8px;
        left: 50%; transform: translateX(-50%);
        display: flex; gap: 8px;
        pointer-events: auto;
        background: rgba(0,0,0,0.55);
        border: 1px solid rgba(0,255,224,0.2);
        padding: 6px 10px; border-radius: 8px;
        backdrop-filter: blur(4px);
        z-index: 3;
      }
      .mob-slot {
        width: 44px; height: 44px;
        border-radius: 6px;
        border: 1px solid rgba(0,255,224,0.3);
        background: rgba(0,255,224,0.07);
        color: #00ffe0;
        font-family: 'Orbitron', monospace;
        font-size: 15px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        transition: background 0.1s, border-color 0.1s;
        pointer-events: auto;
      }
      .mob-slot.active {
        background: rgba(0,255,224,0.22);
        border-color: rgba(0,255,224,0.8);
        box-shadow: 0 0 10px rgba(0,255,224,0.4);
      }
      #mob-resupply {
        display: none;
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        font-family: 'Orbitron', monospace;
        font-size: 12px; letter-spacing: 3px;
        color: #ffdd00;
        background: rgba(0,0,0,0.75);
        border: 2px solid rgba(255,220,0,0.8);
        padding: 12px 24px; border-radius: 8px;
        pointer-events: auto;
        z-index: 5;
        box-shadow: 0 0 20px rgba(255,220,0,0.4);
        touch-action: manipulation;
      }
      #mob-rotate-hint {
        display: none;
        position: fixed; inset: 0; z-index: 9999;
        background: #0a0c10;
        flex-direction: column;
        align-items: center; justify-content: center;
        color: #00ffe0; font-family: 'Orbitron', monospace;
        font-size: 18px; letter-spacing: 4px; text-align: center; gap: 20px;
      }
      @media (orientation: portrait) {
        #mob-rotate-hint { display: flex; }
      }
    `;
    document.head.appendChild(s);

    const hint = document.createElement('div');
    hint.id = 'mob-rotate-hint';
    hint.innerHTML = '<div style="font-size:48px">&#x21BB;</div><div>ROTATE DEVICE</div><div style="font-size:11px;opacity:0.5">가로 모드로 플레이하세요</div>';
    document.body.appendChild(hint);
  }

  _bindEvents() {
    const joystickZone = document.getElementById('mob-joystick-zone');
    const lookZone     = document.getElementById('mob-look-zone');
    const knob         = document.getElementById('mob-joystick-knob');
    const fireBtn      = document.getElementById('mob-fire');
    const aimBtn       = document.getElementById('mob-aim');
    const jumpBtn      = document.getElementById('mob-jump');
    const dashBtn      = document.getElementById('mob-dash');
    const reloadBtn    = document.getElementById('mob-reload');
    const resupplyBtn  = document.getElementById('mob-resupply');

    const MAX_R = 42;

    // ── 조이스틱 ──
    joystickZone.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (this._joystick.active) return;
      this._joystick.active  = true;
      this._joystick.touchId = t.identifier;
      this._joystick.startX  = t.clientX;
      this._joystick.startY  = t.clientY;
    }, { passive: false });

    joystickZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this._joystick.touchId) continue;
        const dx = t.clientX - this._joystick.startX;
        const dy = t.clientY - this._joystick.startY;
        const len = Math.sqrt(dx*dx + dy*dy);
        const cl  = Math.min(len, MAX_R);
        const nx  = len > 0 ? dx/len*cl : 0;
        const ny  = len > 0 ? dy/len*cl : 0;
        knob.style.transform = `translate(${nx}px,${ny}px)`;
        this._joystick.dx = nx / MAX_R;
        this._joystick.dy = ny / MAX_R;
        this._applyJoystick();
      }
    }, { passive: false });

    const endJoystick = e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._joystick.touchId) continue;
        this._joystick.active = false; this._joystick.touchId = null;
        this._joystick.dx = 0; this._joystick.dy = 0;
        knob.style.transform = '';
        this._applyJoystick();
      }
    };
    joystickZone.addEventListener('touchend',    endJoystick, { passive: false });
    joystickZone.addEventListener('touchcancel', endJoystick, { passive: false });

    // ── 시점 드래그 (조준 중에도 허용) ──
    lookZone.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this._look.active) continue;
        this._look.active  = true;
        this._look.touchId = t.identifier;
        this._look.lastX   = t.clientX;
        this._look.lastY   = t.clientY;
      }
    }, { passive: false });

    lookZone.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!this._active) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this._look.touchId) continue;
        const dx = t.clientX - this._look.lastX;
        const dy = t.clientY - this._look.lastY;
        this._look.lastX = t.clientX;
        this._look.lastY = t.clientY;
        // 조준 중이어도 카메라 드래그 허용 (this._mouse.right 상태 전달)
        this.camCtrl.onMouseMove(dx * 3.6, dy * 3.6, this._mouse.right, this.player.scopeProgress);
      }
    }, { passive: false });

    const endLook = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._look.touchId) {
          this._look.active = false; this._look.touchId = null;
        }
      }
    };
    lookZone.addEventListener('touchend',    endLook, { passive: false });
    lookZone.addEventListener('touchcancel', endLook, { passive: false });

    // ── 버튼들 ──
    this._bindHoldBtn(fireBtn,
      () => { this._mouse.left = true; },
      () => { this._mouse.left = false; this.player.mouseLeftHeld = false; }
    );

    // ── 조준 버튼: 토글 방식 ──
    // 처음 누르면 조준 ON (유지), 다시 누르면 조준 OFF
    aimBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      if (this._aimLocked) {
        // 조준 중 → 해제
        this._aimLocked = false;
        this._mouse.right = false;
        aimBtn.classList.remove('pressed');
      } else {
        // 조준 시작 → 잠금
        this._aimLocked = true;
        this._mouse.right = true;
        aimBtn.classList.add('pressed');
      }
    }, { passive: false });
    this._bindHoldBtn(jumpBtn,
      () => { this._keys['Space'] = true; },
      () => { this._keys['Space'] = false; }
    );
    this._bindHoldBtn(dashBtn,
      () => { this._keys['ShiftLeft'] = true; },
      () => { this._keys['ShiftLeft'] = false; }
    );

    reloadBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      this.player.startReload();
    }, { passive: false });

    if (resupplyBtn) {
      resupplyBtn.addEventListener('touchstart', e => {
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
      }, { passive: false });
    }

    // ── 무기 슬롯: stopPropagation으로 look-zone 터치 차단 ──
    document.querySelectorAll('.mob-slot').forEach(btn => {
      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        const slot = Number(btn.dataset.slot);
        // 조준 토글 해제
        if (this._aimLocked) {
          this._aimLocked = false;
          this._mouse.right = false;
          document.getElementById('mob-aim')?.classList.remove('pressed');
        }
        // 재장전 상태 강제 해제 후 슬롯 전환
        this.player.isReloading      = false;
        this.player.reloadTimer      = 0;
        this.player.sniperReloading  = false;
        this.player.pistolReloading  = false;
        this.player.weaponSlot       = slot;
        if (this.player.onHudUpdate) this.player.onHudUpdate();
        this._updateSlotUI();
      }, { passive: false });
    });

    const orig = this.player.onHudUpdate;
    this.player.onHudUpdate = () => { if (orig) orig(); this._updateSlotUI(); };
    this._updateSlotUI();
  }

  _bindHoldBtn(btn, onDown, onUp) {
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('pressed');
      onDown();
    }, { passive: false });
    btn.addEventListener('touchend', e => {
      e.preventDefault();
      btn.classList.remove('pressed');
      onUp();
    }, { passive: false });
    btn.addEventListener('touchcancel', e => {
      btn.classList.remove('pressed');
      onUp();
    }, { passive: false });
  }

  _applyJoystick() {
    const { dx, dy } = this._joystick;
    const DEAD = 0.18;
    this._keys['KeyW'] = dy < -DEAD;
    this._keys['KeyS'] = dy >  DEAD;
    this._keys['KeyA'] = dx < -DEAD;
    this._keys['KeyD'] = dx >  DEAD;
  }

  _updateSlotUI() {
    const slot = this.player.weaponSlot;
    document.querySelectorAll('.mob-slot').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.slot) === slot);
    });
  }

  activate() {
    this.setActive(true);
    const overlay = document.getElementById('lock-overlay');
    if (overlay) overlay.style.display = 'none';
    const hud = document.getElementById('hud');
    if (hud) hud.style.pointerEvents = 'none';
    const ctrl = document.getElementById('mobile-controls');
    if (ctrl) ctrl.style.display = 'flex';
  }
}
