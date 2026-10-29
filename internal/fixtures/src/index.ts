/**
 * Synthetic gantt fixtures shared by the playground and tests (private, never published).
 *
 * - {@link sampleProject}: a synthetic project plan with groups, anchored children, deliverables
 *   and a placeholder row;
 * - {@link edgeCases}: small fixtures, one input problem each;
 * - {@link workingDayScenarios}: FR-SCH-7 scenarios with expected results;
 * - {@link generateFixture}: deterministic large datasets (1k / 10k tasks);
 * - {@link fixtureCatalog}: all of the above under URL-safe ids.
 *
 * Static fixtures are deep-frozen, so code that mutates its input fails loudly (FR-DATA-1).
 * Packages may import this only from test files (enforced by dependency-cruiser).
 *
 * @packageDocumentation
 */

export type { FixtureEntry, FixtureGroup } from './catalog';
export { findFixture, fixtureCatalog, scenarioFixture } from './catalog';
export { edgeCase, edgeCases } from './edge-cases';
export { deepFreeze } from './freeze';
export type { GenerateOptions, GeneratorGranularity } from './generate';
export { generateFixture } from './generate';
export type {
  SampleProjectData,
  SampleProjectDateSource,
  SampleProjectKind,
} from './sample-project';
export { sampleProject } from './sample-project';
export type { IsoDate, WorkingDayAction, WorkingDayScenario } from './scenarios/working-days';
export { workingDayScenarios } from './scenarios/working-days';
export type {
  Fixture,
  FixtureCalendar,
  FixtureDateInput,
  FixtureDurationInput,
  FixtureEditingFlags,
  FixtureLink,
  FixtureLinkType,
  FixtureOptions,
  FixtureTask,
  FixtureTaskId,
} from './types';
