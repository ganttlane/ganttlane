import type { Link, Task } from '@ganttlane/core';

/** The sizes the select offers. */
export const COUNTS = [100, 1_000, 5_000, 10_000] as const;
/** The size the chart opens with: enough to see what the chart does, light enough for a page. */
export const DEFAULT_COUNT = 1_000;

const TEAMS = ['Backend', 'Frontend', 'Docs', 'Marketing', 'QA', 'Design'] as const;
const STAGES = ['Design', 'Build', 'Review', 'QA', 'Release'] as const;
/** How far each stage of a chain has got: the first is done, the second is under way. */
const PROGRESS = [100, 50, 0, 0, 0] as const;

/** The date `n` working days after Monday 2026-01-05, as `'YYYY-MM-DD'`. */
function workingDay(n: number): string {
  const calendarDays = Math.floor(n / 5) * 7 + (n % 5);
  return new Date(Date.UTC(2026, 0, 5 + calendarDays)).toISOString().slice(0, 10);
}

/**
 * Makes a plan of `count` tasks, with no randomness: the same count gives the same tasks every
 * time. The tasks come in chains of five (Design, Build, Review, QA, Release), each one starting
 * after the one before it and linked to it, and the chains start a few days apart, so the chart
 * is a long staircase. Every task starts and ends on a working day, so no task is in conflict
 * with the weekends.
 *
 * @param count - How many tasks.
 * @returns The tasks (ids `t1` … `t<count>`) and about four links for every five of them.
 */
export function generate(count: number): { tasks: Task[]; links: Link[] } {
  const tasks: Task[] = [];
  const links: Link[] = [];
  let day = 0;
  for (let i = 0; i < count; i++) {
    const chain = Math.floor(i / STAGES.length);
    const stage = i % STAGES.length;
    if (stage === 0) day = (chain * 3) % 90;
    const length = 2 + ((chain * 7 + stage * 3) % 5);
    const team = TEAMS[chain % TEAMS.length] ?? 'Team';
    tasks.push({
      id: `t${String(i + 1)}`,
      name: `${team} ${String(chain + 1)} · ${STAGES[stage] ?? ''}`,
      start: workingDay(day),
      end: workingDay(day + length - 1),
      progress: PROGRESS[stage] ?? 0,
    });
    if (stage > 0) links.push({ source: `t${String(i)}`, target: `t${String(i + 1)}` });
    day += length + ((chain + stage) % 2);
  }
  return { tasks, links };
}

// What `createGantt` and the tests get: the plan at its default size.
export const { tasks, links } = generate(DEFAULT_COUNT);
