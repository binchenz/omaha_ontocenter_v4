/**
 * Deterministic PRNG (mulberry32) and random helpers for demo seed scripts.
 * Same seed → identical data across runs.
 */

export function rng(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeHelpers(rand: () => number) {
  return {
    randInt: (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min,
    randFloat: (min: number, max: number) => rand() * (max - min) + min,
    round2: (n: number) => Math.round(n * 100) / 100,
    pickWeighted<T extends { weight: number }>(items: T[]): T {
      const total = items.reduce((s, i) => s + i.weight, 0);
      let r = rand() * total;
      for (const it of items) { if ((r -= it.weight) <= 0) return it; }
      return items[items.length - 1];
    },
  };
}

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
