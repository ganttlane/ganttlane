/**
 * Deterministic generator of large fixtures for performance work (1k / 10k tasks) and
 * property-style tests. The same options always produce the same fixture, on every host.
 *
 * Guarantees (checked by `generate.test.ts`):
 * - exactly `count` tasks with unique ids; parents come before their children and the depth
 *   never exceeds `maxDepth`; children lie within their parent's planned range;
 * - links reference existing, dated tasks, never connect a task to its ancestor and always point
 *   from an earlier task to a later one, so the link graph is acyclic;
 * - every date and duration is a multiple of `granularity` (day-precision tasks are date-only).
 */

import { formatDay, formatMinute, MINUTES_PER_DAY, toDayNumber } from './dates';
import type { Random } from './random';
import { createRandom } from './random';
import type { Fixture, FixtureLink, FixtureLinkType, FixtureTask } from './types';

/** Data steps the generator supports: `'1d'` or a sub-day step that divides 24 hours. */
export type GeneratorGranularity =
  | '1d'
  | '12h'
  | '8h'
  | '6h'
  | '4h'
  | '3h'
  | '2h'
  | '1h'
  | '30min'
  | '20min'
  | '15min'
  | '10min'
  | '5min'
  | '1min';

/** Options of {@link generateFixture}. Every field has a default. */
export interface GenerateOptions {
  /** Number of tasks. Default `1000`. */
  count?: number;
  /** PRNG seed. Default `1`. */
  seed?: number;
  /** Maximum number of hierarchy levels (`1` = flat). Default `3`. */
  maxDepth?: number;
  /** Expected number of incoming links per task (may exceed 1). Default `0.3`. */
  linkDensity?: number;
  /** First possible start, `'YYYY-MM-DD'`. Default `'2026-03-02'` (a Monday). */
  start?: string;
  /** `scheduling.granularity` of the fixture. Default `'1d'`. */
  granularity?: GeneratorGranularity;
  /** Date-only tasks, tasks with time, or a mix. Default `'day'`. */
  precision?: 'day' | 'time' | 'mixed';
}

const GRANULARITY_MINUTES: Record<GeneratorGranularity, number> = {
  '1d': 1440,
  '12h': 720,
  '8h': 480,
  '6h': 360,
  '4h': 240,
  '3h': 180,
  '2h': 120,
  '1h': 60,
  '30min': 30,
  '20min': 20,
  '15min': 15,
  '10min': 10,
  '5min': 5,
  '1min': 1,
};

const VERBS = ['Plan', 'Design', 'Build', 'Review', 'Test', 'Deploy', 'Validate', 'Deliver'];
const NOUNS = ['backend', 'frontend', 'api', 'database', 'auth', 'reports', 'search', 'docs'];
const LINK_TYPES: readonly FixtureLinkType[] = [
  ...Array<FixtureLinkType>(16).fill('FS'),
  'SS',
  'SS',
  'FF',
  'SF',
];

/** Planned task, in minutes since the epoch (`end` exclusive). */
interface Planned {
  depth: number;
  parent: number | undefined;
  precision: 'day' | 'time';
  span: { start: number; end: number } | undefined;
}

/** Formats minutes as a compound duration: `'2d'`, `'6h'`, `'1d 4h 30min'`. */
function formatDuration(minutes: number): string {
  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const hours = Math.floor((minutes % MINUTES_PER_DAY) / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (rest > 0) parts.push(`${rest}min`);
  return parts.join(' ');
}

function assertOptions(count: number, maxDepth: number, linkDensity: number): void {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`count must be ≥ 0: ${count}`);
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new RangeError(`maxDepth must be ≥ 1: ${maxDepth}`);
  }
  if (!Number.isFinite(linkDensity) || linkDensity < 0) {
    throw new RangeError(`linkDensity must be ≥ 0: ${linkDensity}`);
  }
}

/**
 * Generates a fixture with a hierarchy and acyclic links.
 *
 * @example
 * ```ts
 * const big = generateFixture({ count: 10_000 });
 * const hourly = generateFixture({ count: 500, granularity: '1h', precision: 'time', seed: 7 });
 * ```
 *
 * @param options - Size, shape and seed; see {@link GenerateOptions}.
 * @returns A new (unfrozen) fixture; the caller owns it.
 */
export function generateFixture(options: GenerateOptions = {}): Fixture {
  const {
    count = 1000,
    seed = 1,
    maxDepth = 3,
    linkDensity = 0.3,
    start = '2026-03-02',
    granularity = '1d',
    precision = 'day',
  } = options;
  assertOptions(count, maxDepth, linkDensity);

  const random = createRandom(seed);
  const step = GRANULARITY_MINUTES[granularity];
  const slotsPerDay = MINUTES_PER_DAY / step;
  const planned: Planned[] = [];
  const tasks: FixtureTask[] = [];
  /** Indices of the open ancestors of the next task. */
  const stack: number[] = [];
  let cursor = toDayNumber(start) * MINUTES_PER_DAY;

  for (let index = 0; index < count; index++) {
    const previous = planned.at(-1);
    if (previous?.span && previous.depth + 1 < maxDepth && random.chance(0.35)) {
      stack.push(index - 1);
    } else {
      while (stack.length > 0 && random.chance(0.3)) stack.pop();
    }
    const parentIndex = stack.at(-1);
    const parent = parentIndex === undefined ? undefined : planned[parentIndex];
    const depth = parent ? parent.depth + 1 : 0;
    const id = `task-${index + 1}`;
    const name = `${random.pick(VERBS)} ${random.pick(NOUNS)} ${index + 1}`;
    const parentField = parentIndex === undefined ? {} : { parentId: `task-${parentIndex + 1}` };

    if (random.chance(0.01)) {
      planned.push({ depth, parent: parentIndex, precision: 'day', span: undefined });
      tasks.push({ id, name, type: 'placeholder', ...parentField });
      continue;
    }

    let taskPrecision: 'day' | 'time' =
      precision === 'mixed' ? (random.chance(0.5) ? 'day' : 'time') : precision;
    if (parent?.precision === 'time') taskPrecision = 'time';
    const unit = taskPrecision === 'day' ? MINUTES_PER_DAY : step;

    let span: { start: number; end: number };
    if (parent?.span) {
      const available = (parent.span.end - parent.span.start) / unit;
      const offset = random.int(0, available - 1);
      const maxLength = taskPrecision === 'day' ? 10 : 2 * slotsPerDay;
      const length = random.int(1, Math.min(available - offset, maxLength));
      const taskStart = parent.span.start + offset * unit;
      span = { start: taskStart, end: taskStart + length * unit };
    } else {
      const taskStart =
        cursor +
        random.int(0, 3) * MINUTES_PER_DAY +
        (taskPrecision === 'day' ? 0 : random.int(0, slotsPerDay - 1) * step);
      const length = taskPrecision === 'day' ? random.int(1, 15) : random.int(1, 2 * slotsPerDay);
      span = { start: taskStart, end: taskStart + length * unit };
      cursor += random.int(0, 1) * MINUTES_PER_DAY;
    }
    planned.push({ depth, parent: parentIndex, precision: taskPrecision, span });

    const useEnd = random.chance(0.5);
    const task: FixtureTask = { id, name, ...parentField };
    if (taskPrecision === 'day') {
      task.start = formatDay(span.start / MINUTES_PER_DAY);
      if (useEnd) task.end = formatDay(span.end / MINUTES_PER_DAY - 1);
      else task.duration = (span.end - span.start) / MINUTES_PER_DAY;
      if (random.chance(0.25)) task.durationMode = 'working';
    } else {
      task.start = formatMinute(span.start);
      if (useEnd) task.end = formatMinute(span.end);
      else task.duration = formatDuration(span.end - span.start);
    }
    if (random.chance(0.8)) task.progress = random.int(0, 100);
    tasks.push(task);
  }

  return {
    name: `generated-${count}`,
    description:
      `${count} generated tasks (seed ${seed}, up to ${maxDepth} levels, ~${linkDensity} links ` +
      `per task, ${precision} precision, granularity ${granularity}).`,
    tasks,
    links: generateLinks(planned, random, linkDensity, step),
    calendar: { weekends: [0, 6] },
    options: { scheduling: { granularity }, hierarchy: { expandedKeys: 'all' } },
  };
}

function isAncestor(planned: readonly Planned[], ancestor: number, of: number): boolean {
  for (let current = planned[of]?.parent; current !== undefined;) {
    if (current === ancestor) return true;
    current = planned[current]?.parent;
  }
  return false;
}

/** Links always go from an earlier task to a later one, so the graph is always acyclic. */
function generateLinks(
  planned: readonly Planned[],
  random: Random,
  linkDensity: number,
  step: number,
): FixtureLink[] {
  const links: FixtureLink[] = [];
  const seen = new Set<string>();
  const whole = Math.floor(linkDensity);
  const fraction = linkDensity - whole;

  for (let target = 1; target < planned.length; target++) {
    const successor = planned[target];
    if (!successor?.span) continue;
    const wanted = whole + (random.chance(fraction) ? 1 : 0);
    for (let made = 0, attempts = 0; made < wanted && attempts < wanted * 3; attempts++) {
      const source = random.int(Math.max(0, target - 50), target - 1);
      const key = `${source}:${target}`;
      if (!planned[source]?.span || seen.has(key) || isAncestor(planned, source, target)) continue;
      seen.add(key);
      made++;
      const link: FixtureLink = {
        id: `link-${links.length + 1}`,
        source: `task-${source + 1}`,
        target: `task-${target + 1}`,
        type: random.pick(LINK_TYPES),
      };
      if (random.chance(0.1)) {
        link.lag =
          successor.precision === 'day'
            ? random.int(1, 3)
            : formatDuration(random.int(1, 4) * step);
      }
      links.push(link);
    }
  }
  return links;
}
