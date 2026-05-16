// mobile.js - 모바일 터치 컨트롤 시스템

export const isMobile = (() => {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
})();

export class MobileControls {
  constructor(camCtrl, player) {
    this.camCtrl = camCtrl;
    this.player  = player;

    // 가상 키 상태 (player.keys에 주입)
    this._keys = player.keys;
    this._mouse = player.mouse;

    // 조이스틱 상태
    this._joystick = {
      active: false,
      touchId: null,
      startX: 0, startY: 0,
      dx: 0, dy: 0,
    };

    // 시점 드래그 상태
    this._look = {
      active: false,
      touchId: null,
      lastX: 0, lastY: 0,
    };

    // 발사 버튼 touch id
    this._shootTouchId  = null;
    this._aimTouchId    = null;
    this._jumpTouchId   = null;
    this._dashTouchId   = null;
    this._reloadTouchId = null;

    this._active = false; // 게임 진입 전엔 비활성
  }

  setActive(v) { this._active = v; }

  // ── DOM 생성 ──
  buildUI() {
    if (!isMobile) return;

    // 컨테이너
    const c = document.createElement('div');
    c.id = 'mobile-controls';
    c.style.display = 'none'; // 게임 진입 전엔 숨김
    c.innerHTML = `
      <!-- 전체 화면 시점 드래그 영역 (최하단) -->
      <div id="mob-look-zone"></div>

      <!-- 좌측: 조이스틱 영역 -->
      <div id="mob-left">
        <div id="mob-joystick-zone">
          <div id="mob-joystick-base">
            <div id="mob-joystick-knob"></div>
          </div>
        </div>
      </div>

      <!-- 우측: 점프/대시/리로드 + 공격키 -->
      <div id="mob-right">
        <div id="mob-right-btns">
          <button class="mob-btn" id="mob-jump">▲<span>JUMP</span></button>
          <button class="mob-btn" id="mob-dash">⚡<span>DASH</span></button>
          <button class="mob-btn" id="mob-reload">↺<span>RELOAD</span></button>
          <button class="mob-btn mob-aim" id="mob-aim">◎<span>AIM</span></button>
          <button class="mob-btn mob-fire" id="mob-fire">🔴<span>FIRE</span></button>
        </div>
      </div>


      <!-- 보급품 버튼 (가까울 때만 표시) -->
      <button id="mob-resupply" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        font-family:'Orbitron',monospace;font-size:12px;letter-spacing:3px;color:#ffdd00;
        background:rgba(0,0,0,0.7);border:2px solid rgba(255,220,0,0.8);padding:12px 24px;
        border-radius:8px;pointer-events:auto;z-index:10;
        box-shadow:0 0 20px rgba(255,220,0,0.4);touch-action:manipulation;">
        📦 RESUPPLY
      </button>

      <!-- 무기 슬롯 (하단 중앙) -->
      <div id="mob-weapon-bar">
        <button class="mob-slot" data-slot="1" id="mob-slot-1">1</button>
        <button class="mob-slot" data-slot="2" id="mob-slot-2">2</button>
        <button class="mob-slot" data-slot="5" id="mob-slot-5">3</button>
        <button class="mob-slot" data-slot="4" id="mob-slot-4">💣</button>
        <button class="mob-slot" data-slot="3" id="mob-slot-3">🩹</button>
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
        user-select: none;
        -webkit-user-select: none;
      }
      /* 전체 화면 시점 드래그 (최하단 레이어) */
      #mob-look-zone {
        position: absolute; inset: 0;
        pointer-events: auto;
        touch-action: none;
        z-index: 0;
      }
      /* 좌/우 절반 */
      #mob-left, #mob-right {
        flex: 1; position: relative;
        display: flex; flex-direction: column;
        pointer-events: none;
        z-index: 1;
      }
      /* 조이스틱 영역 */
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
        transition: opacity 0.15s;
      }
      #mob-joystick-knob {
        width: 44px; height: 44px; border-radius: 50%;
        background: rgba(0,255,224,0.35);
        border: 2px solid rgba(0,255,224,0.7);
        position: absolute;
        box-shadow: 0 0 12px rgba(0,255,224,0.4);
        transition: transform 0.05s;
      }
      /* 우측 버튼들 (점프/대시/리로드 + AIM/FIRE 모두 우측) */
      #mob-right-btns {
        position: absolute; bottom: 20px; right: 24px;
        display: flex; flex-direction: column; gap: 8px;
        align-items: flex-end;
        pointer-events: auto;
      }
      /* 공통 버튼 */
      .mob-btn {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 2px;
        font-family: 'Orbitron', monospace;
        font-size: 14px; line-height: 1;
        border-radius: 50%;
        width: 42px; height: 42px;
        border: 2px solid rgba(0,255,224,0.35);
        background: rgba(0,0,0,0.45);
        color: #00ffe0;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: none;
        pointer-events: auto;
        box-shadow: 0 0 10px rgba(0,255,224,0.15);
      }
      .mob-btn span { font-size: 6px; letter-spacing: 1px; opacity: 0.65; font-family: 'Share Tech Mono', monospace; }
      .mob-btn:active, .mob-btn.pressed { background: rgba(0,255,224,0.22); box-shadow: 0 0 18px rgba(0,255,224,0.4); }
      .mob-fire {
        width: 56px; height: 56px;
        border-color: rgba(255,80,80,0.6);
        color: #ff5050;
        font-size: 18px;
        box-shadow: 0 0 14px rgba(255,80,80,0.2);
      }
      .mob-fire.pressed { background: rgba(255,80,80,0.25); box-shadow: 0 0 22px rgba(255,80,80,0.5); }
      .mob-aim {
        width: 48px; height: 48px;
        border-color: rgba(255,204,0,0.5);
        color: #ffcc00;
      }
      .mob-aim.pressed { background: rgba(255,204,0,0.2); }
      /* 무기 바 */
      #mob-weapon-bar {
        position: absolute; bottom: 8px;
        left: 50%; transform: translateX(-50%);
        display: flex; gap: 8px;
        pointer-events: auto;
        background: rgba(0,0,0,0.5);
        border: 1px solid rgba(0,255,224,0.2);
        padding: 6px 10px; border-radius: 8px;
        backdrop-filter: blur(4px);
      }
      .mob-slot {
        width: 48px; height: 48px;
        border-radius: 6px;
        border: 1px solid rgba(0,255,224,0.3);
        background: rgba(0,255,224,0.07);
        color: #00ffe0;
        font-family: 'Orbitron', monospace;
        font-size: 16px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        transition: background 0.1s, border-color 0.1s;
      }
      .mob-slot.active {
        background: rgba(0,255,224,0.22);
        border-color: rgba(0,255,224,0.8);
        box-shadow: 0 0 10px rgba(0,255,224,0.4);
      }
      /* 랜드스케이프 강제 안내 */
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

    // 세로 모드 안내
    const hint = document.createElement('div');
    hint.id = 'mob-rotate-hint';
    hint.innerHTML = '<div style="font-size:48px">↻</div><div>ROTATE DEVICE</div><div style="font-size:11px;opacity:0.5">가로 모드로 플레이하세요</div>';
    document.body.appendChild(hint);
  }

  _bindEvents() {
    const joystickZone = document.getElementById('mob-joystick-zone');
    const lookZone     = document.getElementById('mob-look-zone');
    const base         = document.getElementById('mob-joystick-base');
    const knob         = document.getElementById('mob-joystick-knob');
    const fireBtn      = document.getElementById('mob-fire');
    const aimBtn       = document.getElementById('mob-aim');
    const jumpBtn      = document.getElementById('mob-jump');
    const dashBtn      = document.getElementById('mob-dash');
    const reloadBtn    = document.getElementById('mob-reload');

    const MAX_R = 42; // 조이스틱 최대 반경

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
        const clamped = Math.min(len, MAX_R);
        const nx = len > 0 ? dx/len * clamped : 0;
        const ny = len > 0 ? dy/len * clamped : 0;
        knob.style.transform = `translate(${nx}px, ${ny}px)`;
        this._joystick.dx = nx / MAX_R;
        this._joystick.dy = ny / MAX_R;
        this._applyJoystick();
      }
    }, { passive: false });

    const endJoystick = e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._joystick.touchId) continue;
        this._joystick.active = false;
        this._joystick.touchId = null;
        this._joystick.dx = 0;
        this._joystick.dy = 0;
        knob.style.transform = '';
        this._applyJoystick();
      }
    };
    joystickZone.addEventListener('touchend',    endJoystick, { passive: false });
    joystickZone.addEventListener('touchcancel', endJoystick, { passive: false });

    // ── 시점 드래그: 전체 화면 어디서나 클릭 후 드래그 ──
    // look-zone은 z-index 0으로 전체 화면 커버,
    // 버튼들은 pointer-events:auto + z-index 높아서 먼저 잡힘
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
        this.camCtrl.onMouseMove(dx * 3.6, dy * 3.6, this._mouse.right, this.player.scopeProgress);
      }
    }, { passive: false });

    const endLook = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._look.touchId) {
          this._look.active  = false;
          this._look.touchId = null;
        }
      }
    };
    lookZone.addEventListener('touchend',    endLook, { passive: false });
    lookZone.addEventListener('touchcancel', endLook, { passive: false });

    // ── 발사 버튼 ──
    this._bindHoldBtn(fireBtn, () => { this._mouse.left = true; }, () => { this._mouse.left = false; this.player.mouseLeftHeld = false; });
    this._bindHoldBtn(aimBtn,  () => { this._mouse.right = true; }, () => { this._mouse.right = false; });

    // ── 점프 ──
    this._bindHoldBtn(jumpBtn, () => { this._keys['Space'] = true; }, () => { this._keys['Space'] = false; });

    // ── 대시 ──
    this._bindHoldBtn(dashBtn, () => { this._keys['ShiftLeft'] = true; }, () => { this._keys['ShiftLeft'] = false; });

    // ── 재장전 ──
    reloadBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      this.player.startReload();
    }, { passive: false });

    // ── 보급품 버튼 ──
    const resupplyBtn = document.getElementById('mob-resupply');
    if (resupplyBtn) {
      resupplyBtn.addEventListener('touchstart', e => {
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
      }, { passive: false });
    }

    // ── 무기 슬롯 ──
    document.querySelectorAll('.mob-slot').forEach(btn => {
      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        const slot = Number(btn.dataset.slot);
        this.player.weaponSlot = slot;
        if (this.player.onHudUpdate) this.player.onHudUpdate();
        this._updateSlotUI();
      }, { passive: false });
    });

    // 슬롯 UI 동기화 (매 프레임 대신 HUD 업데이트 훅 사용)
    const orig = this.player.onHudUpdate;
    this.player.onHudUpdate = () => { if (orig) orig(); this._updateSlotUI(); };
    this._updateSlotUI();
  }

  _bindHoldBtn(btn, onDown, onUp) {
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
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

  // 게임 진입 시 lock overlay 숨기고 활성화
  activate() {
    this.setActive(true);
    const overlay = document.getElementById('lock-overlay');
    if (overlay) overlay.style.display = 'none';
    // HUD pointer-events none 해제
    const hud = document.getElementById('hud');
    if (hud) hud.style.pointerEvents = 'none';
    // 게임 진입 후 모바일 컨트롤 표시
    const ctrl = document.getElementById('mobile-controls');
    if (ctrl) ctrl.style.display = 'flex';
  }
}
