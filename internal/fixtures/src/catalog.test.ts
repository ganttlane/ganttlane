import { describe, expect, it } from 'vitest';

import { findFixture, fixtureCatalog, scenarioFixture } from './catalog';
import { edgeCases } from './edge-cases';
import { workingDayScenarios } from './scenarios/working-days';

describe('fixture catalog', () => {
  it('has unique, URL-safe ids', () => {
    const ids = fixtureCatalog.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('lists the dataset, every edge case, the generated presets and every scenario', () => {
    const ids = fixtureCatalog.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'sample-project',
        'generated-1k',
        'generated-10k',
        ...edgeCases.map((fixture) => `edge-${fixture.name}`),
        ...workingDayScenarios.map((scenario) => `scenario-${scenario.id}`),
      ]),
    );
  });

  it('loads generated presets with the advertised size, once', () => {
    const entry = findFixture('generated-1k')!;
    const fixture = entry.load();
    expect(fixture.tasks).toHaveLength(1000);
    expect(entry.load()).toBe(fixture);
    expect(Object.isFrozen(fixture.tasks[0])).toBe(true);
    expect(findFixture('generated-10k')!.load().tasks).toHaveLength(10_000);
  });

  it('returns undefined for an unknown id', () => {
    expect(findFixture('nope')).toBeUndefined();
  });

  it('wraps a scenario as a one-task fixture describing the expected result', () => {
    const scenario = workingDayScenarios[0]!;
    const fixture = scenarioFixture(scenario);
    expect(fixture.tasks).toEqual([scenario.given.task]);
    expect(fixture.calendar).toBe(scenario.given.calendar);
    expect(fixture.description).toContain(scenario.expected.end);
  });
});
