export const WEAPON_CATALOG = [
  { id:'m4a1', name:'M4A1', icon:'R', mode:'AUTO', auto:true, maxAmmo:30, reserve:120, reload:72, fireRate:7, recoil:0.22, damage:{ HEAD:22, BODY:11, LEGS:6 }, color:'#00ffe0' },
  { id:'sniper', name:'SNIPER', icon:'S', mode:'SEMI', auto:false, maxAmmo:4, reserve:20, reload:132, fireRate:42, recoil:0.62, scope:true, damage:{ HEAD:100, BODY:40, LEGS:22 }, color:'#ffcc00' },
  { id:'pistol', name:'PISTOL', icon:'P', mode:'SEMI', auto:false, maxAmmo:12, reserve:60, reload:54, fireRate:13, recoil:0.14, damage:{ HEAD:28, BODY:17, LEGS:9 }, color:'#b8d7ff' },
  { id:'smg', name:'VECTOR', icon:'V', mode:'AUTO', auto:true, maxAmmo:34, reserve:136, reload:62, fireRate:4, recoil:0.13, damage:{ HEAD:15, BODY:8, LEGS:5 }, color:'#7dff8a' },
  { id:'shotgun', name:'BREACH', icon:'B', mode:'PUMP', auto:false, maxAmmo:6, reserve:30, reload:96, fireRate:42, recoil:0.58, pellets:6, spread:0.18, damage:{ HEAD:16, BODY:11, LEGS:7 }, color:'#ff7d4d' },
  { id:'lmg', name:'HAMMER', icon:'H', mode:'AUTO', auto:true, maxAmmo:54, reserve:162, reload:150, fireRate:9, recoil:0.30, damage:{ HEAD:24, BODY:13, LEGS:7 }, color:'#ff9966' },
  { id:'dmr', name:'VANTAGE', icon:'D', mode:'SEMI', auto:false, maxAmmo:12, reserve:48, reload:86, fireRate:22, recoil:0.34, damage:{ HEAD:55, BODY:28, LEGS:15 }, color:'#b986ff' },
  { id:'burst', name:'PULSE', icon:'U', mode:'BURST', auto:false, maxAmmo:24, reserve:96, reload:72, fireRate:16, recoil:0.24, damage:{ HEAD:24, BODY:12, LEGS:6 }, color:'#ff66c4' },
  { id:'rail', name:'RAIL', icon:'X', mode:'CHARGE', auto:false, maxAmmo:3, reserve:15, reload:145, fireRate:62, recoil:0.72, damage:{ HEAD:90, BODY:52, LEGS:24 }, color:'#66a6ff' },
  { id:'carbine', name:'CARBINE', icon:'C', mode:'AUTO', auto:true, maxAmmo:26, reserve:104, reload:66, fireRate:6, recoil:0.18, damage:{ HEAD:19, BODY:10, LEGS:6 }, color:'#ffffff' },
  { id:'rpg', name:'RPG-7', icon:'🚀', mode:'ROCKET', auto:false, maxAmmo:1, reserve:3, reload:110, fireRate:60, recoil:0.9, isProjectile:true, projectileSpeed:0.55, splashRadius:8.0, damage:{ HEAD:60, BODY:40, LEGS:40 }, color:'#ff4400' },
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
