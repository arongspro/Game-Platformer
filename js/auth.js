// auth.js - Firebase Auth + 캐릭터 커스터마이징 + 로그인/회원가입

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase, ref, set, get, child
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCHXYjHr67AHEj6cfUUn5jxGfKa3c5adYE",
  authDomain:        "multiplatformer-6db0f.firebaseapp.com",
  databaseURL:       "https://multiplatformer-6db0f-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "multiplatformer-6db0f",
  storageBucket:     "multiplatformer-6db0f.firebasestorage.app",
  messagingSenderId: "74962223394",
  appId:             "1:74962223394:web:e4ab2a77d480a19474e57b",
  measurementId:     "G-VDQ9ESN8L5"
};

// 앱 중복 초기화 방지
const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ── 기본 캐릭터 팔레트 ──
export const DEFAULT_CHAR = {
  head:  '#4477bb',
  body:  '#3366aa',
  legs:  '#2255aa',
  arms:  '#3366aa',
};

// 16×16 픽셀 캐릭터 (앞면만) - 기본 템플릿
export const DEFAULT_PIXELS = (() => {
  const grid = [];
  for (let y = 0; y < 16; y++) {
    const row = [];
    for (let x = 0; x < 16; x++) {
      // 머리: 4~11 x, 0~4 y
      if (x>=4&&x<=11&&y>=0&&y<=4)      row.push('#4477bb');
      // 눈: y=2, x=5~6, x=9~10
      else if (y===2&&(x===5||x===6||x===9||x===10)) row.push('#000000');
      // 몸통: 3~12 x, 5~10 y
      else if (x>=3&&x<=12&&y>=5&&y<=10) row.push('#3366aa');
      // 왼팔: 0~2 x, 5~9 y
      else if (x>=0&&x<=2&&y>=5&&y<=9)   row.push('#3366aa');
      // 오른팔: 13~15 x, 5~9 y
      else if (x>=13&&x<=15&&y>=5&&y<=9) row.push('#3366aa');
      // 왼다리: 4~7 x, 11~15 y
      else if (x>=4&&x<=7&&y>=11&&y<=15) row.push('#2255aa');
      // 오른다리: 8~11 x, 11~15 y
      else if (x>=8&&x<=11&&y>=11&&y<=15)row.push('#2255aa');
      else row.push(null); // 투명
    }
    grid.push(row);
  }
  return grid;
})();

// ── 유틸 ──
function hashPassword(pw) {
  // 간단한 해시 (실서비스는 서버사이드 bcrypt 필요)
  let h = 0;
  for (let i = 0; i < pw.length; i++) {
    h = ((h << 5) - h) + pw.charCodeAt(i);
    h |= 0;
  }
  return h.toString(16);
}

// ── 회원가입 ──
export async function register(nickname, password, pixels) {
  nickname = nickname.trim();
  if (!nickname || nickname.length < 2) throw new Error('닉네임은 2자 이상이어야 합니다.');
  if (nickname.length > 12)             throw new Error('닉네임은 12자 이하여야 합니다.');
  if (!password || password.length < 4) throw new Error('비밀번호는 4자 이상이어야 합니다.');

  // 닉네임 중복 체크
  const snap = await get(child(ref(db), `users/${nickname}`));
  if (snap.exists()) throw new Error('이미 사용 중인 닉네임입니다.');

  await set(ref(db, `users/${nickname}`), {
    password: hashPassword(password),
    pixels:   pixels,
    kills:    0,
    deaths:   0,
    rating:   0,
    createdAt: Date.now(),
  });
  return { nickname, pixels, kills: 0, deaths: 0, rating: 0 };
}

// ── 로그인 ──
export async function login(nickname, password) {
  nickname = nickname.trim();
  const snap = await get(child(ref(db), `users/${nickname}`));
  if (!snap.exists()) throw new Error('존재하지 않는 닉네임입니다.');
  const data = snap.val();
  if (data.password !== hashPassword(password)) throw new Error('비밀번호가 틀렸습니다.');
  return {
    nickname,
    pixels: data.pixels,
    kills: data.kills || 0,
    deaths: data.deaths || 0,
    rating: data.rating || 0,
  };
}

// ── 킬/데스 업데이트 ──
export async function updateKD(nickname, kills, deaths) {
  await set(ref(db, `users/${nickname}/kills`),  kills);
  await set(ref(db, `users/${nickname}/deaths`), deaths);
}

export { db, app };
