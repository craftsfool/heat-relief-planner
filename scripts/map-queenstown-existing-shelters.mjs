import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const gridPath = path.join(projectRoot, "src/data/queenstownGrid.json");
const grid = JSON.parse(fs.readFileSync(gridPath, "utf8"));
const cellFormat = Object.fromEntries(grid.metadata.cellFormat.map((field, index) => [field, index]));
const cellById = new Map(grid.cells.map((cell) => [
  `${cell[cellFormat.x]}-${cell[cellFormat.y]}`,
  cell,
]));
const { west, south, east, north } = grid.metadata.bbox;
const bbox = `${south},${west},${north},${east}`;
const query = `[out:json][timeout:120];(
nwr["shop"~"mall|supermarket|convenience"](${bbox});
nwr["amenity"~"cafe|food_court|community_centre|library|drinking_water|shelter"](${bbox});
);out center;`;
const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const fetchFacilities = async () => {
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "HeatReliefPlanner/1.0 (NUS modelling project)",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`Overpass endpoint failed: ${endpoint} (${error.message})`);
    }
  }
  throw new Error(`Unable to fetch existing facilities: ${lastError?.message}`);
};

const kindFor = (tags) => {
  if (tags.shop === "mall") return "mall";
  if (tags.shop === "supermarket") return "supermarket";
  if (tags.shop === "convenience") return "convenience";
  if (tags.amenity === "food_court") return "food_court";
  if (tags.amenity === "community_centre") return "community";
  if (tags.amenity === "library") return "library";
  if (tags.amenity === "cafe") return "cafe";
  if (tags.amenity === "drinking_water") return "water";
  if (tags.amenity === "shelter") return "shelter";
  return null;
};
const serviceFor = {
  convenience: { capacity: 25, radius: 100 },
  cafe: { capacity: 30, radius: 100 },
  water: { capacity: 15, radius: 80 },
  shelter: { capacity: 30, radius: 100 },
  supermarket: { capacity: 80, radius: 120 },
  food_court: { capacity: 120, radius: 150 },
  library: { capacity: 120, radius: 150 },
  community: { capacity: 180, radius: 150 },
  mall: { capacity: 400, radius: 200 },
};
const meanLatitudeRadians = ((north + south) / 2) * Math.PI / 180;
const lonStep = grid.metadata.cellSizeMetres / (111_320 * Math.cos(meanLatitudeRadians));
const latStep = grid.metadata.cellSizeMetres / 110_574;
const coordinateToGrid = (lon, lat) => ({
  x: Math.floor((lon - west) / lonStep),
  y: Math.floor((north - lat) / latStep),
});
const nearestCell = (lon, lat) => {
  const origin = coordinateToGrid(lon, lat);
  for (let radius = 0; radius <= 4; radius += 1) {
    let best = null;
    for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
      for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
        const cell = cellById.get(`${x}-${y}`);
        if (!cell) continue;
        const distance = Math.hypot(x - origin.x, y - origin.y);
        if (!best || distance < best.distance) best = { cell, distance };
      }
    }
    if (best) return best.cell;
  }
  return null;
};

const osm = process.env.QUEENSTOWN_FACILITIES
  ? JSON.parse(fs.readFileSync(process.env.QUEENSTOWN_FACILITIES, "utf8"))
  : await fetchFacilities();
const uniqueFacilities = new Map();
for (const element of osm.elements ?? []) {
  const kind = kindFor(element.tags ?? {});
  const lon = element.lon ?? element.center?.lon;
  const lat = element.lat ?? element.center?.lat;
  if (!kind || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
  const cell = nearestCell(lon, lat);
  if (!cell) continue;
  const x = cell[cellFormat.x];
  const y = cell[cellFormat.y];
  const label = element.tags?.name ?? kind.replaceAll("_", " ");
  const key = `${x}-${y}:${kind}:${label.toLowerCase()}`;
  if (uniqueFacilities.has(key)) continue;
  uniqueFacilities.set(key, {
    osmId: `${element.type}/${element.id}`,
    x,
    y,
    lon: Number(lon.toFixed(6)),
    lat: Number(lat.toFixed(6)),
    kind,
    label,
  });
}

const sheltersByCell = new Map();
for (const facility of uniqueFacilities.values()) {
  const service = serviceFor[facility.kind];
  const key = `${facility.x}-${facility.y}`;
  const current = sheltersByCell.get(key) ?? {
    id: `existing-${key}`,
    x: facility.x,
    y: facility.y,
    lon: facility.lon,
    lat: facility.lat,
    kind: facility.kind,
    label: facility.label,
    capacity: 0,
    radius: 0,
    facilityCount: 0,
    osmIds: [],
  };
  current.capacity += service.capacity;
  current.radius = Math.max(current.radius, service.radius);
  current.facilityCount += 1;
  current.osmIds.push(facility.osmId);
  if (service.capacity > serviceFor[current.kind].capacity) {
    current.kind = facility.kind;
    current.label = facility.label;
  }
  sheltersByCell.set(key, current);
}

grid.existingShelters = [...sheltersByCell.values()]
  .map((shelter) => ({
    ...shelter,
    label: shelter.facilityCount > 1
      ? `${shelter.label} + ${shelter.facilityCount - 1} nearby`
      : shelter.label,
  }))
  .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));

for (const shelter of grid.existingShelters) {
  const cell = cellById.get(`${shelter.x}-${shelter.y}`);
  const flags = cell[cellFormat.flags];
  cell[cellFormat.flags] = (flags | 128) & ~16;
}
grid.metadata.existingShelterSource = {
  name: "OpenStreetMap cooling-capable amenities",
  attribution: "© OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/copyright",
  generatedAt: new Date().toISOString(),
  capacityNote:
    "Capacities are planning assumptions by amenity type, not official occupancy limits.",
};
grid.metadata.counts.facilities = uniqueFacilities.size;
grid.metadata.counts.existingShelterCells = grid.existingShelters.length;
grid.metadata.counts.existingShelterCapacity = grid.existingShelters
  .reduce((sum, shelter) => sum + shelter.capacity, 0);

fs.writeFileSync(gridPath, `${JSON.stringify(grid)}\n`);
console.log({
  facilities: uniqueFacilities.size,
  shelterCells: grid.existingShelters.length,
  totalCapacity: grid.metadata.counts.existingShelterCapacity,
  kinds: Object.fromEntries(
    Object.keys(serviceFor).map((kind) => [
      kind,
      [...uniqueFacilities.values()].filter((facility) => facility.kind === kind).length,
    ]),
  ),
});
