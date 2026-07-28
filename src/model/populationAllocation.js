const EPSILON = 1e-7;

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (items[parent][0] <= item[0]) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = item;
  }

  pop() {
    const items = this.items;
    if (!items.length) return null;
    const root = items[0];
    const last = items.pop();
    if (!items.length) return root;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= items.length) break;
      const child = right < items.length && items[right][0] < items[left][0]
        ? right
        : left;
      if (items[child][0] >= last[0]) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return root;
  }
}

const addEdge = (graph, from, to, capacity, cost) => {
  const forward = {
    to,
    reverse: graph[to].length,
    capacity,
    initialCapacity: capacity,
    cost,
  };
  const backward = {
    to: from,
    reverse: graph[from].length,
    capacity: 0,
    initialCapacity: 0,
    cost: -cost,
  };
  graph[from].push(forward);
  graph[to].push(backward);
  return forward;
};

const runMinCostMaximumFlow = (graph, source, sink) => {
  const nodeCount = graph.length;
  const potential = new Float64Array(nodeCount);
  let totalFlow = 0;

  while (true) {
    const distance = new Float64Array(nodeCount);
    distance.fill(Number.POSITIVE_INFINITY);
    const previousNode = new Int32Array(nodeCount);
    const previousEdge = new Int32Array(nodeCount);
    previousNode.fill(-1);
    previousEdge.fill(-1);
    distance[source] = 0;

    const queue = new MinHeap();
    queue.push([0, source]);
    while (queue.items.length) {
      const [currentDistance, node] = queue.pop();
      if (currentDistance > distance[node] + EPSILON) continue;
      for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex += 1) {
        const edge = graph[node][edgeIndex];
        if (edge.capacity <= EPSILON) continue;
        const nextDistance = currentDistance + edge.cost + potential[node] - potential[edge.to];
        if (nextDistance >= distance[edge.to] - EPSILON) continue;
        distance[edge.to] = nextDistance;
        previousNode[edge.to] = node;
        previousEdge[edge.to] = edgeIndex;
        queue.push([nextDistance, edge.to]);
      }
    }

    if (!Number.isFinite(distance[sink])) break;
    for (let node = 0; node < nodeCount; node += 1) {
      if (Number.isFinite(distance[node])) potential[node] += distance[node];
    }

    let amount = Number.POSITIVE_INFINITY;
    for (let node = sink; node !== source; node = previousNode[node]) {
      if (previousNode[node] < 0) {
        amount = 0;
        break;
      }
      amount = Math.min(amount, graph[previousNode[node]][previousEdge[node]].capacity);
    }
    if (amount <= EPSILON || !Number.isFinite(amount)) break;

    for (let node = sink; node !== source; node = previousNode[node]) {
      const from = previousNode[node];
      const edge = graph[from][previousEdge[node]];
      edge.capacity -= amount;
      graph[node][edge.reverse].capacity += amount;
    }
    totalFlow += amount;
  }

  return totalFlow;
};

export function allocatePopulationToStations({
  stations,
  residual,
  available,
  columns,
  rows,
  getDistanceBands,
  stationCapacity,
}) {
  const servedByCell = new Float64Array(residual.length);
  const perStation = new Map();
  if (!stations.length) return { served: 0, servedByCell, perStation };

  const demandEntries = [];
  const demandPositionByIndex = new Map();
  for (let index = 0; index < residual.length; index += 1) {
    if (!available[index] || residual[index] <= EPSILON) continue;
    demandPositionByIndex.set(index, demandEntries.length);
    demandEntries.push({ index, demand: residual[index] });
  }

  const source = 0;
  const stationOffset = 1;
  const demandOffset = stationOffset + stations.length;
  const sink = demandOffset + demandEntries.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const stationSourceEdges = [];
  const demandSinkEdges = [];

  for (let stationIndex = 0; stationIndex < stations.length; stationIndex += 1) {
    const station = stations[stationIndex];
    const capacity = stationCapacity(station);
    stationSourceEdges.push(addEdge(
      graph,
      source,
      stationOffset + stationIndex,
      capacity,
      0,
    ));

    for (const band of getDistanceBands(station.radius ?? 100)) {
      for (const offset of band) {
        const x = station.x + offset.x;
        const y = station.y + offset.y;
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
        const index = y * columns + x;
        const demandPosition = demandPositionByIndex.get(index);
        if (demandPosition === undefined) continue;
        const distanceSquared = offset.x ** 2 + offset.y ** 2;
        const deterministicTieBreak = index;
        addEdge(
          graph,
          stationOffset + stationIndex,
          demandOffset + demandPosition,
          capacity,
          distanceSquared * (residual.length + 1) + deterministicTieBreak,
        );
      }
    }
  }

  for (let demandPosition = 0; demandPosition < demandEntries.length; demandPosition += 1) {
    demandSinkEdges.push(addEdge(
      graph,
      demandOffset + demandPosition,
      sink,
      demandEntries[demandPosition].demand,
      0,
    ));
  }

  const served = runMinCostMaximumFlow(graph, source, sink);
  for (let stationIndex = 0; stationIndex < stations.length; stationIndex += 1) {
    const edge = stationSourceEdges[stationIndex];
    perStation.set(
      stations[stationIndex].id,
      Math.max(0, edge.initialCapacity - edge.capacity),
    );
  }
  for (let demandPosition = 0; demandPosition < demandEntries.length; demandPosition += 1) {
    const edge = demandSinkEdges[demandPosition];
    const amount = Math.max(0, edge.initialCapacity - edge.capacity);
    const index = demandEntries[demandPosition].index;
    servedByCell[index] = amount;
    residual[index] = Math.max(0, residual[index] - amount);
  }

  return { served, servedByCell, perStation };
}
