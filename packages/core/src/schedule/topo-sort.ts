/**
 * Graph algorithms over nodes numbered `0 … n - 1`: a stable topological
 * sort (Kahn's algorithm with a min-heap, so ready nodes leave in input order) and the strongly
 * connected components with more than one node (iterative Tarjan, no recursion). Both are
 * O((V + E) log V) at most and safe for 10k+ nodes. {@link topoSort} wraps the sort for any node
 * type, so propagation can combine link edges with parent → child edges.
 */

/**
 * Successors of every node: `adjacency[v]` lists the nodes that `v` points to (duplicates allowed,
 * a self-loop makes a node unsortable).
 *
 * @internal
 */
export type Adjacency = readonly (readonly number[] | undefined)[];

/** Result of {@link topoSort}, deeply frozen. */
export interface TopoSortResult<T> {
  /**
   * Nodes such that every edge goes from an earlier to a later node. Among nodes whose
   * predecessors are all placed, the one first in input order comes first, so a graph without
   * edges keeps the input order. Without cycles it contains every node once.
   */
  readonly order: readonly T[];
  /** Nodes on a cycle or after one, which could not be placed, in input order. */
  readonly blocked: readonly T[];
}

const NONE: readonly number[] = /* @__PURE__ */ Object.freeze([]);

/** Reads a slot that exists; the fallback only satisfies `noUncheckedIndexedAccess`. */
function at(values: ArrayLike<number>, i: number): number {
  return values[i] ?? 0;
}

/**
 * Sorts nodes topologically, ties by input order. Generic: nodes are compared with
 * `Map` semantics (`===`, `NaN` equal to itself); a repeated node counts once (its first
 * position), edges to or from unknown nodes are ignored and repeated edges are fine.
 *
 * @param nodes - The nodes in their input order.
 * @param edges - `[from, to]` pairs: `from` must come before `to`.
 * @returns The order and the nodes that could not be placed because of a cycle.
 *
 * @example
 * ```ts
 * topoSort(['c', 'b', 'a'], [['a', 'b']]); // { order: ['c', 'a', 'b'], blocked: [] }
 * topoSort([1, 2, 3], [[1, 2], [2, 1]]);    // { order: [3], blocked: [1, 2] }
 * ```
 */
export function topoSort<T>(
  nodes: readonly T[],
  edges: Iterable<readonly [T, T]>,
): TopoSortResult<T> {
  const indexOf = new Map<T, number>();
  const unique: T[] = [];
  for (const node of nodes) {
    if (indexOf.has(node)) continue;
    indexOf.set(node, unique.length);
    unique.push(node);
  }
  const adjacency: number[][] = unique.map(() => []);
  for (const [from, to] of edges) {
    const a = indexOf.get(from);
    const b = indexOf.get(to);
    if (a !== undefined && b !== undefined) adjacency[a]?.push(b);
  }
  const { order, blocked } = sortIndexes(adjacency);
  const pick = (index: number): T => unique[index] as T;
  return Object.freeze({
    order: Object.freeze(order.map(pick)),
    blocked: Object.freeze(blocked.map(pick)),
  });
}

/**
 * Kahn's algorithm over node indexes with a min-heap: of the ready nodes, the smallest index
 * goes first, which gives the lexicographically smallest topological order.
 *
 * @returns The sorted indexes and, ascending, the indexes left over by cycles.
 * @internal
 */
export function sortIndexes(adjacency: Adjacency): { order: number[]; blocked: number[] } {
  const size = adjacency.length;
  const indegree = new Int32Array(size);
  for (const successors of adjacency) {
    for (const w of successors ?? NONE) indegree[w] = at(indegree, w) + 1;
  }
  // Ascending, hence already a valid min-heap.
  const heap: number[] = [];
  for (let v = 0; v < size; v++) if (indegree[v] === 0) heap.push(v);
  const order: number[] = [];
  while (heap.length > 0) {
    const v = popMin(heap);
    order.push(v);
    for (const w of adjacency[v] ?? NONE) {
      const left = at(indegree, w) - 1;
      indegree[w] = left;
      if (left === 0) pushHeap(heap, w);
    }
  }
  const blocked: number[] = [];
  if (order.length < size) for (let v = 0; v < size; v++) if (at(indegree, v) > 0) blocked.push(v);
  return { order, blocked };
}

/**
 * Strongly connected components with more than one node, found with an iterative Tarjan
 * algorithm. Each component lists its nodes ascending; components are ordered by their smallest
 * node. Self-loops are not reported (a one-node component is never returned).
 *
 * @internal
 */
export function cyclicComponents(adjacency: Adjacency): number[][] {
  const size = adjacency.length;
  const discovered = new Int32Array(size).fill(-1);
  const low = new Int32Array(size);
  const next = new Int32Array(size);
  const onStack = new Uint8Array(size);
  const stack: number[] = [];
  const frames: number[] = [];
  const components: number[][] = [];
  let counter = 0;
  const visit = (v: number): void => {
    discovered[v] = counter;
    low[v] = counter;
    counter++;
    stack.push(v);
    onStack[v] = 1;
    frames.push(v);
  };

  for (let root = 0; root < size; root++) {
    if (at(discovered, root) !== -1) continue;
    visit(root);
    while (frames.length > 0) {
      const v = at(frames, frames.length - 1);
      const successors = adjacency[v] ?? NONE;
      const i = at(next, v);
      if (i < successors.length) {
        next[v] = i + 1;
        const w = at(successors, i);
        if (at(discovered, w) === -1) visit(w);
        else if (onStack[w] === 1) low[v] = Math.min(at(low, v), at(discovered, w));
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const parent = at(frames, frames.length - 1);
        low[parent] = Math.min(at(low, parent), at(low, v));
      }
      if (low[v] !== discovered[v]) continue;
      const component: number[] = [];
      let w: number;
      do {
        w = stack.pop() ?? v;
        onStack[w] = 0;
        component.push(w);
      } while (w !== v);
      if (component.length > 1) components.push(component.sort(ascending));
    }
  }
  return components.sort((a, b) => at(a, 0) - at(b, 0));
}

function ascending(a: number, b: number): number {
  return a - b;
}

function pushHeap(heap: number[], value: number): void {
  let i = heap.length;
  heap.push(value);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const above = at(heap, parent);
    if (above <= value) break;
    heap[i] = above;
    i = parent;
  }
  heap[i] = value;
}

function popMin(heap: number[]): number {
  const top = at(heap, 0);
  const last = heap.pop() ?? top;
  const size = heap.length;
  if (size === 0) return top;
  let i = 0;
  for (;;) {
    let child = 2 * i + 1;
    if (child >= size) break;
    if (child + 1 < size && at(heap, child + 1) < at(heap, child)) child++;
    const below = at(heap, child);
    if (below >= last) break;
    heap[i] = below;
    i = child;
  }
  heap[i] = last;
  return top;
}
