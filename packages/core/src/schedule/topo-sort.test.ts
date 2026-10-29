import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { cyclicComponents, sortIndexes, topoSort } from './topo-sort';

describe('topoSort', () => {
  it('FR-SCH-5: sorts any node type, ties in input order', () => {
    expect(topoSort(['c', 'b', 'a'], [['a', 'b']])).toEqual({
      order: ['c', 'a', 'b'],
      blocked: [],
    });
    expect(topoSort([3, 1, 2], [])).toEqual({ order: [3, 1, 2], blocked: [] });
    const parent = { id: 'parent' };
    const child = { id: 'child' };
    expect(topoSort([child, parent], [[parent, child]]).order).toEqual([parent, child]);
  });

  it('FR-SCH-5: combines several edge sources, repeated edges and nodes are fine', () => {
    const links: [string, string][] = [['b', 'c']];
    const parents: [string, string][] = [
      ['a', 'b'],
      ['a', 'b'],
    ];
    const result = topoSort(['c', 'b', 'a', 'b'], [...links, ...parents]);
    expect(result).toEqual({ order: ['a', 'b', 'c'], blocked: [] });
  });

  it('FR-SCH-5: ignores edges to unknown nodes and treats NaN as one node', () => {
    expect(
      topoSort(
        [1, 2],
        [
          [3, 1],
          [2, 1],
        ],
      ),
    ).toEqual({ order: [2, 1], blocked: [] });
    expect(topoSort([NaN, 0], [[0, NaN]]).order).toEqual([0, NaN]);
  });

  it('FR-LINK-7: nodes on or after a cycle are blocked, in input order', () => {
    expect(
      topoSort(
        ['x', 'a', 'b', 'c', 'y'],
        [
          ['a', 'b'],
          ['b', 'a'],
          ['b', 'c'],
          ['x', 'a'],
        ],
      ),
    ).toEqual({ order: ['x', 'y'], blocked: ['a', 'b', 'c'] });
    expect(topoSort(['self'], [['self', 'self']])).toEqual({ order: [], blocked: ['self'] });
  });

  it('FR-DATA-1: returns frozen results', () => {
    const result = topoSort(['a'], []);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.order)).toBe(true);
    expect(Object.isFrozen(result.blocked)).toBe(true);
  });

  /** A random graph over `0 … size - 1` given as an edge list. */
  const graphs = fc.integer({ min: 1, max: 12 }).chain((size) =>
    fc.record({
      size: fc.constant(size),
      edges: fc.array(fc.tuple(fc.nat({ max: size - 1 }), fc.nat({ max: size - 1 })), {
        maxLength: 30,
      }),
    }),
  );

  it('FR-SCH-5: property: every node once, edges respected, the smallest ready node first', () => {
    fc.assert(
      fc.property(graphs, ({ size, edges }) => {
        const nodes = Array.from({ length: size }, (_, i) => i);
        const { order, blocked } = topoSort(nodes, edges);
        expect([...order, ...blocked].sort((a, b) => a - b)).toEqual(nodes);
        const position = new Map(order.map((node, i) => [node, i]));
        const blockedSet = new Set(blocked);
        for (const [from, to] of edges) {
          if (blockedSet.has(from)) expect(blockedSet.has(to)).toBe(true);
          else if (!blockedSet.has(to)) {
            expect(position.get(from)!).toBeLessThan(position.get(to)!);
          }
        }
        // Greedy check: each placed node is the smallest one whose predecessors were all placed.
        const placed = new Set<number>();
        for (const node of order) {
          const ready = nodes.filter(
            (candidate) =>
              !placed.has(candidate) &&
              !blockedSet.has(candidate) &&
              edges.every(([from, to]) => to !== candidate || placed.has(from)),
          );
          expect(node).toBe(Math.min(...ready));
          placed.add(node);
        }
      }),
    );
  });

  it('FR-SCH-5: property: a DAG sorts completely', () => {
    const dags = graphs.chain(({ size, edges }) =>
      fc
        .shuffledSubarray(
          Array.from({ length: size }, (_, i) => i),
          { minLength: size, maxLength: size },
        )
        .map((rank) => ({
          size,
          // Orient every edge from the lower to the higher rank: no cycles.
          edges: edges
            .filter(([a, b]) => a !== b)
            .map(([a, b]): [number, number] =>
              rank.indexOf(a) < rank.indexOf(b) ? [a, b] : [b, a],
            ),
        })),
    );
    fc.assert(
      fc.property(dags, ({ size, edges }) => {
        const { order, blocked } = topoSort(
          Array.from({ length: size }, (_, i) => i),
          edges,
        );
        expect(blocked).toEqual([]);
        expect(order).toHaveLength(size);
      }),
    );
  });
});

describe('index algorithms', () => {
  it('FR-LINK-7: finds strongly connected components without recursion', () => {
    expect(cyclicComponents([[1], [2], [0, 3], [3], [5], [4]])).toEqual([
      [0, 1, 2],
      [4, 5],
    ]);
    expect(cyclicComponents([[0], undefined, [1]])).toEqual([]);
    const size = 100_000;
    const ring = Array.from({ length: size }, (_, i) => [(i + 1) % size]);
    expect(cyclicComponents(ring)[0]).toHaveLength(size);
    const chain = Array.from({ length: size }, (_, i) => (i + 1 < size ? [i + 1] : []));
    expect(cyclicComponents(chain)).toEqual([]);
    expect(sortIndexes(chain).order).toHaveLength(size);
  });

  it('FR-LINK-7: property: components are exactly the mutually reachable nodes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }).chain((size) =>
          fc.array(fc.array(fc.nat({ max: size - 1 }), { maxLength: 3 }), {
            minLength: size,
            maxLength: size,
          }),
        ),
        (adjacency) => {
          const reach = adjacency.map((_, start) => {
            const seen = new Set<number>();
            const queue = [...adjacency[start]!];
            for (const node of queue) {
              if (seen.has(node)) continue;
              seen.add(node);
              queue.push(...adjacency[node]!);
            }
            return seen;
          });
          const expected = adjacency
            .map((_, v) =>
              adjacency
                .map((__, w) => w)
                .filter((w) => w === v || (reach[v]!.has(w) && reach[w]!.has(v))),
            )
            .filter((component, v) => component.length > 1 && component[0] === v);
          expect(cyclicComponents(adjacency)).toEqual(expected);
        },
      ),
    );
  });
});
