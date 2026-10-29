import { edgeCase, type Fixture, sampleProject } from '@ganttlane/fixtures';
import { describe, expect, it } from 'vitest';

import { createWorkCalendar } from '../calendar';
import { type DurationMode, type NormalizedModel, normalizeModel, type TaskId } from '../model';
import { buildLinkGraph, type LinkGraph, type ScheduleIssue } from './index';

/** Normalizes a fixture with its calendar and data options, then builds its graph. */
function graphOf<TData>(
  fixture: Fixture<TData>,
  durationMode?: DurationMode,
): { model: NormalizedModel<TData>; graph: LinkGraph } {
  const { calendar } = createWorkCalendar(fixture.calendar);
  const scheduling = fixture.options?.scheduling;
  const model = normalizeModel(fixture, {
    calendar,
    granularity: scheduling?.granularity,
    durationMode: durationMode ?? scheduling?.durationMode,
    defaultLinkType: scheduling?.defaultLinkType,
  });
  expect(model.issues).toEqual([]);
  return { model, graph: buildLinkGraph(model) };
}

function codes(issues: readonly ScheduleIssue[]): string[] {
  return issues.map((issue) => `${issue.code}@${issue.path ?? ''}`);
}

/** Whether every active link that is not on a cycle points forward in the order. */
function respectsLinks(graph: LinkGraph): boolean {
  const position = new Map<TaskId, number>(graph.topologicalOrder.map((id, i) => [id, i]));
  return graph.links.every(
    (link) =>
      !link.active ||
      link.inCycle ||
      (position.get(link.source) ?? -1) < (position.get(link.target) ?? -1),
  );
}

describe('fixtures', () => {
  it('FR-LINK-7: link-cycle reports the cycle and the self-link', () => {
    const { graph } = graphOf(edgeCase('link-cycle'));
    expect(codes(graph.issues)).toEqual(['self-link@links[3]', 'cycle@']);
    expect(graph.issues[1]).toMatchObject({
      taskIds: ['A', 'B', 'C'],
      linkIds: ['A:FS:B', 'B:FS:C', 'C:FS:A'],
    });
    expect(graph.links.map((link) => [link.id, link.inCycle])).toEqual([
      ['A:FS:B', true],
      ['B:FS:C', true],
      ['C:FS:A', true],
      ['E:FS:F', false],
    ]);
    expect(graph.topologicalOrder).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('FR-DATA-4: unknown-link-target drops the links to missing tasks', () => {
    const { graph } = graphOf(edgeCase('unknown-link-target'));
    expect(graph.issues.map((issue) => [issue.code, issue.path, issue.value])).toEqual([
      ['unknown-link-task', 'links[0]', 'ghost'],
      ['unknown-link-task', 'links[1]', 'ghost-source'],
    ]);
    expect(graph.links.map((link) => link.id)).toEqual(['a:FS:b']);
  });

  it('FR-LINK-1, FR-LINK-2, FR-LINK-8: link-types resolves every type and lag', () => {
    const lags = (mode: DurationMode): [string, number | undefined, boolean | undefined][] =>
      graphOf(edgeCase('link-types'), mode).graph.links.map((link) => [
        link.id,
        link.lag?.days,
        link.lag?.derived,
      ]);
    expect(lags('calendar')).toEqual([
      ['a:SS:ss', 0, true],
      ['a:FF:ff', 0, true],
      ['a:SF:sf', 0, true],
      ['a:FS:fs-ff', 2, true],
      ['a:FF:fs-ff', 7, true],
      ['a:FS:lead', -1, false],
      ['a:FS:lag', 2, false],
      ['a:FS:default', 2, true],
    ]);
    expect(lags('working')).toEqual([
      ['a:SS:ss', 0, true],
      ['a:FF:ff', 0, true],
      ['a:SF:sf', 0, true],
      ['a:FS:fs-ff', 0, true],
      ['a:FF:fs-ff', 5, true],
      ['a:FS:lead', -1, false],
      ['a:FS:lag', 2, false],
      ['a:FS:default', 0, true],
    ]);
  });

  it('FR-LINK-8, FR-SCH-5: sample-project has working-day lags and an ordered chain', () => {
    const { model, graph } = graphOf(sampleProject);
    expect(graph.issues).toEqual([]);
    expect(
      graph.links.map((link) => [link.id, link.active, link.editable, link.lag?.days]),
    ).toEqual([
      ['group-1:FS:group-2', true, true, 0],
      ['group-2:FS:group-3', true, true, 0],
      ['group-3:FS:group-4', true, true, 1],
      ['group-4:FS:group-5', true, true, 0],
      ['group-5:FS:group-6', true, true, 0],
      ['task-3:FS:task-4', true, false, 0],
      ['task-6:FS:task-7', true, false, 0],
      ['task-8:FS:task-9', true, false, 0],
    ]);
    expect(graph.links.every((link) => link.lag?.mode === 'working')).toBe(true);
    expect(
      graph.links.filter((link) => link.lag?.derived === false).map((link) => link.id),
    ).toEqual(['group-3:FS:group-4']);
    expect(respectsLinks(graph)).toBe(true);
    expect([...graph.topologicalOrder].sort()).toEqual(model.tasks.map((task) => task.id).sort());
  });
});
