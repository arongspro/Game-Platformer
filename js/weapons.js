export const WEAPON_CATALOG = [
  { id:'m4a1', name:'M4A1', icon:'R', mode:'AUTO', auto:true, maxAmmo:30, reserve:120, reload:60, fireRate:6, recoil:0.30, damage:{ HEAD:20, BODY:10, LEGS:5 }, color:'#00ffe0' },
  { id:'sniper', name:'SNIPER', icon:'S', mode:'SEMI', auto:false, maxAmmo:5, reserve:25, reload:110, fireRate:28, recoil:0.85, scope:true, damage:{ HEAD:100, BODY:40, LEGS:25 }, color:'#ffcc00' },
  { id:'pistol', name:'PISTOL', icon:'P', mode:'SEMI', auto:false, maxAmmo:12, reserve:48, reload:70, fireRate:14, recoil:0.22, damage:{ HEAD:30, BODY:20, LEGS:10 }, color:'#b8d7ff' },
  { id:'smg', name:'VECTOR', icon:'V', mode:'AUTO', auto:true, maxAmmo:36, reserve:144, reload:55, fireRate:3, recoil:0.18, damage:{ HEAD:16, BODY:8, LEGS:5 }, color:'#7dff8a' },
  { id:'shotgun', name:'BREACH', icon:'B', mode:'PUMP', auto:false, maxAmmo:6, reserve:30, reload:82, fireRate:34, recoil:0.95, pellets:6, spread:0.18, damage:{ HEAD:18, BODY:12, LEGS:7 }, color:'#ff7d4d' },
  { id:'lmg', name:'HAMMER', icon:'H', mode:'AUTO', auto:true, maxAmmo:60, reserve:180, reload:130, fireRate:8, recoil:0.42, damage:{ HEAD:22, BODY:13, LEGS:7 }, color:'#ff9966' },
  { id:'dmr', name:'VANTAGE', icon:'D', mode:'SEMI', auto:false, maxAmmo:14, reserve:56, reload:78, fireRate:18, recoil:0.48, damage:{ HEAD:55, BODY:28, LEGS:15 }, color:'#b986ff' },
  { id:'burst', name:'PULSE', icon:'U', mode:'BURST', auto:false, maxAmmo:24, reserve:96, reload:66, fireRate:12, recoil:0.34, damage:{ HEAD:24, BODY:12, LEGS:6 }, color:'#ff66c4' },
  { id:'rail', name:'RAIL', icon:'X', mode:'CHARGE', auto:false, maxAmmo:3, reserve:18, reload:120, fireRate:54, recoil:1.05, damage:{ HEAD:90, BODY:55, LEGS:25 }, color:'#66a6ff' },
  { id:'carbine', name:'CARBINE', icon:'C', mode:'AUTO', auto:true, maxAmmo:24, reserve:96, reload:58, fireRate:5, recoil:0.26, damage:{ HEAD:18, BODY:11, LEGS:6 }, color:'#ffffff' },
];

export const DEFAULT_LOADOUT = ['m4a1', 'sniper', 'pistol'];

export function getWeaponById(id) {
  return WEAPON_CATALOG.find(w => w.id === id) || WEAPON_CATALOG[0];
}

export function normalizeLoadout(ids) {
  const result = [];
  for (const id of ids || []) {
    if (WEAPON_CATALOG.some(w => w.id === id) && !result.includes(id)) result.push(id);
    if (result.length === 3) break;
  }
  for (const id of DEFAULT_LOADOUT) {
    if (!result.includes(id)) result.push(id);
    if (result.length === 3) break;
  }
  return result;
}
