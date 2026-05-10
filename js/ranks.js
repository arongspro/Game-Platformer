export const RATING_TIERS = [
  { name: '아이언 V', min: 0, max: 39, color: '#8c8f96' },
  { name: '아이언 IV', min: 40, max: 79, color: '#8c8f96' },
  { name: '아이언 III', min: 80, max: 119, color: '#8c8f96' },
  { name: '아이언 II', min: 120, max: 159, color: '#8c8f96' },
  { name: '아이언 I', min: 160, max: 199, color: '#8c8f96' },
  { name: '브론즈 V', min: 200, max: 239, color: '#b46f3c' },
  { name: '브론즈 IV', min: 240, max: 279, color: '#b46f3c' },
  { name: '브론즈 III', min: 280, max: 319, color: '#b46f3c' },
  { name: '브론즈 II', min: 320, max: 359, color: '#b46f3c' },
  { name: '브론즈 I', min: 360, max: 399, color: '#b46f3c' },
  { name: '실버 V', min: 400, max: 439, color: '#c7d0d9' },
  { name: '실버 IV', min: 440, max: 479, color: '#c7d0d9' },
  { name: '실버 III', min: 480, max: 519, color: '#c7d0d9' },
  { name: '실버 II', min: 520, max: 559, color: '#c7d0d9' },
  { name: '실버 I', min: 560, max: 599, color: '#c7d0d9' },
  { name: '골드 V', min: 600, max: 639, color: '#ffcc33' },
  { name: '골드 IV', min: 640, max: 679, color: '#ffcc33' },
  { name: '골드 III', min: 680, max: 719, color: '#ffcc33' },
  { name: '골드 II', min: 720, max: 759, color: '#ffcc33' },
  { name: '골드 I', min: 760, max: 799, color: '#ffcc33' },
  { name: '플래티넘 V', min: 800, max: 839, color: '#4ee6d0' },
  { name: '플래티넘 IV', min: 840, max: 879, color: '#4ee6d0' },
  { name: '플래티넘 III', min: 880, max: 919, color: '#4ee6d0' },
  { name: '플래티넘 II', min: 920, max: 959, color: '#4ee6d0' },
  { name: '플래티넘 I', min: 960, max: 999, color: '#4ee6d0' },
  { name: '다이아몬드 V', min: 1000, max: 1199, color: '#66a6ff' },
  { name: '다이아몬드 IV', min: 1200, max: 1399, color: '#66a6ff' },
  { name: '다이아몬드 III', min: 1400, max: 1599, color: '#66a6ff' },
  { name: '다이아몬드 II', min: 1600, max: 1799, color: '#66a6ff' },
  { name: '다이아몬드 I', min: 1800, max: Infinity, color: '#b986ff' },
];

export function getRatingTier(rating = 0, challenger = false) {
  if (challenger) return { name: '챌린저', min: 1800, max: Infinity, color: '#ff4fd8' };
  return RATING_TIERS.find(t => rating >= t.min && rating <= t.max) || RATING_TIERS[0];
}
