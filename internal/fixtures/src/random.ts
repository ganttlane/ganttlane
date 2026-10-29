/** A small seeded pseudo-random source (no dependencies, same sequence on every host). */
export interface Random {
  /** Uniform float in `[0, 1)`. */
  next(): number;
  /** Uniform integer in `[min, max]` (inclusive). */
  int(min: number, max: number): number;
  /** `true` with probability `p`. */
  chance(p: number): boolean;
  /** A uniformly chosen element of a non-empty list. */
  pick<T>(items: readonly T[]): T;
}

/**
 * Creates a mulberry32 generator: 32-bit state, fast, good enough for test data.
 *
 * @param seed - Any integer; the same seed always yields the same sequence.
 * @returns The generator.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() needs at least one item');
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}
