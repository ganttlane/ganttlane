/**
 * One list of every fixture under a URL-safe id, for pickers (playground) and table-driven tests.
 */

import { edgeCases } from './edge-cases';
import { deepFreeze } from './freeze';
import { generateFixture } from './generate';
import { sampleProject } from './sample-project';
import type { WorkingDayScenario } from './scenarios/working-days';
import { workingDayScenarios } from './scenarios/working-days';
import type { Fixture } from './types';

/** Picker group of a catalog entry. */
export type FixtureGroup = 'dataset' | 'edge-case' | 'generated' | 'scenario';

/** A selectable fixture. */
export interface FixtureEntry {
  /** URL-safe, unique id, e.g. `'sample-project'`, `'edge-link-cycle'`, `'generated-1k'`. */
  id: string;
  label: string;
  group: FixtureGroup;
  /** Returns the (deep-frozen) fixture; generated ones are built on first call and cached. */
  load: () => Fixture;
}

/**
 * Wraps an FR-SCH-7 scenario as a one-task fixture whose description states the action and the
 * expected result.
 *
 * @param scenario - Working-day scenario.
 * @returns Fixture with the scenario's task, calendar and options.
 */
export function scenarioFixture(scenario: WorkingDayScenario): Fixture {
  const { given, action, expected } = scenario;
  const conflict = action.onConflict ? `, ${action.onConflict} the non-working-day prompt` : '';
  return {
    name: scenario.id,
    description:
      `${scenario.title}. Action: ${action.kind} to ${action.to}${conflict}. ` +
      `Expected: ${expected.start} → ${expected.end}, ${expected.workingDays} working days.`,
    tasks: [given.task],
    links: [],
    calendar: given.calendar,
    ...(given.options === undefined ? {} : { options: given.options }),
  };
}

function cached(build: () => Fixture): () => Fixture {
  let fixture: Fixture | undefined;
  return () => (fixture ??= deepFreeze(build()));
}

/** Every fixture, in picker order: dataset, edge cases, generated, scenarios. */
export const fixtureCatalog: readonly FixtureEntry[] = Object.freeze([
  {
    id: 'sample-project',
    label: 'sample-project',
    group: 'dataset',
    load: () => sampleProject,
  },
  ...edgeCases.map((fixture): FixtureEntry => ({
    id: `edge-${fixture.name}`,
    label: fixture.name,
    group: 'edge-case',
    load: () => fixture,
  })),
  {
    id: 'generated-1k',
    label: '1,000 tasks',
    group: 'generated',
    load: cached(() => generateFixture({ count: 1000 })),
  },
  {
    id: 'generated-10k',
    label: '10,000 tasks',
    group: 'generated',
    load: cached(() => generateFixture({ count: 10_000 })),
  },
  {
    id: 'generated-1k-hourly',
    label: "1,000 tasks, time precision, granularity '1h'",
    group: 'generated',
    load: cached(() => generateFixture({ count: 1000, granularity: '1h', precision: 'time' })),
  },
  ...workingDayScenarios.map((scenario): FixtureEntry => ({
    id: `scenario-${scenario.id}`,
    label: scenario.title,
    group: 'scenario',
    load: cached(() => scenarioFixture(scenario)),
  })),
]);

/**
 * Finds a catalog entry by id.
 *
 * @param id - Entry id, e.g. from a `?fixture=` query parameter.
 * @returns The entry, or `undefined` for an unknown id.
 */
export function findFixture(id: string): FixtureEntry | undefined {
  return fixtureCatalog.find((entry) => entry.id === id);
}
