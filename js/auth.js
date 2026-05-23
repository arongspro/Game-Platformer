// auth.js — Firebase 제거, 자체 REST API 사용
// 서버의 POST /api/register, POST /api/login 으로 통신

// ── 서버 주소 ─────────────────────────────────────────────
// 개발: http://localhost:3000
// 배포: 서버 IP 또는 도메인으로 변경
export const API_BASE = 'https://game-proxy.juhyung1234567910.workers.dev';// 비워두면 현재 도메인 기준 (같은 서버에서 서빙할 때)

// ── uid 생성 (로그인 시 닉네임 기반으로 결정론적 생성) ────
// Firebase의 anonymous uid 역할: 닉네임이 곧 식별자
function makeUid(nickname) {
  // 간단한 해시로 고정 uid 생성 — 같은 닉네임이면 항상 같은 uid
  let h = 5381;
  for (let i = 0; i < nickname.length; i++) {
    h = ((h << 5) + h) ^ nickname.charCodeAt(i);
    h |= 0;
  }
  return 'u_' + (h >>> 0).toString(16).padStart(8, '0');
}

// ── 기본 픽셀 캐릭터 ───────────────────────────────────────
export const DEFAULT_PIXELS = (() => {
  const grid = [];
  for (let y = 0; y < 16; y++) {
    const row = [];
    for (let x = 0; x < 16; x++) {
      if      (x>=4&&x<=11&&y>=0&&y<=4)                          row.push('#4477bb');
      else if (y===2&&(x===5||x===6||x===9||x===10))             row.push('#000000');
      else if (x>=3&&x<=12&&y>=5&&y<=10)                         row.push('#3366aa');
      else if ((x>=0&&x<=2||x>=13&&x<=15)&&y>=5&&y<=9)          row.push('#3366aa');
      else if ((x>=4&&x<=7||x>=8&&x<=11)&&y>=11&&y<=15)         row.push('#2255aa');
      else                                                         row.push(null);
    }
    grid.push(row);
  }
  return grid;
})();

// ── 회원가입 ──────────────────────────────────────────────
export async function register(nickname, password, pixels) {
  const res = await fetch(`${API_BASE}/api/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ nickname: nickname.trim(), password, pixels }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '회원가입 실패');

  const uid = makeUid(data.nickname);
  return { ...data, uid };
}

// ── 로그인 ────────────────────────────────────────────────
export async function login(nickname, password) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ nickname: nickname.trim(), password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '로그인 실패');

  const uid = makeUid(data.nickname);
  return { ...data, uid };
}

// ── 하위 호환: Firebase에서 쓰던 ensureAuth / getCurrentUid ─
// network.js 등에서 import 해서 쓰는 경우를 위해 더미로 유지
export function ensureAuth() {
  // 더 이상 Firebase anonymous auth 불필요
  return Promise.resolve({ uid: null });
}
export function getCurrentUid() {
  try {
    const u = JSON.parse(sessionStorage.getItem('vp_user') || 'null');
    return u?.uid || null;
  } catch { return null; }
}
