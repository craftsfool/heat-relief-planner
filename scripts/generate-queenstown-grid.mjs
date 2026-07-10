import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { booleanPointInPolygon, point, polygon } from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const boundaryPath = process.env.QUEENSTOWN_BOUNDARY ?? "/tmp/queenstown-boundary.geojson";
const osmPath = process.env.QUEENSTOWN_OSM ?? "/tmp/queenstown-osm.json";
const outputPath = path.join(projectRoot, "src/data/queenstownGrid.json");

const COLS = 46;
const ROWS = 44;
const boundaryCollection = JSON.parse(fs.readFileSync(boundaryPath, "utf8"));
const boundary = boundaryCollection.features[0];
const osm = JSON.parse(fs.readFileSync(osmPath, "utf8"));

const allBoundaryPoints = [];
const collectPoints = (value) => {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number") {
    allBoundaryPoints.push(value);
    return;
  }
  if (Array.isArray(value)) value.forEach(collectPoints);
};
collectPoints(boundary.geometry.coordinates);

const bbox = {
  west: Math.min(...allBoundaryPoints.map(([lon]) => lon)),
  south: Math.min(...allBoundaryPoints.map(([, lat]) => lat)),
  east: Math.max(...allBoundaryPoints.map(([lon]) => lon)),
  north: Math.max(...allBoundaryPoints.map(([, lat]) => lat)),
};

const lonStep = (bbox.east - bbox.west) / COLS;
const latStep = (bbox.north - bbox.south) / ROWS;
const meanLatitudeRadians = ((bbox.north + bbox.south) / 2) * Math.PI / 180;
const cellWidthMetres = lonStep * 111_320 * Math.cos(meanLatitudeRadians);
const cellHeightMetres = latStep * 110_574;
const cellSizeMetres = Math.round((cellWidthMetres + cellHeightMetres) / 2);

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const indexOf = (x, y) => y * COLS + x;
const lonLatToGrid = (lon, lat) => ({
  x: clamp(Math.floor((lon - bbox.west) / lonStep), 0, COLS - 1),
  y: clamp(Math.floor((bbox.north - lat) / latStep), 0, ROWS - 1),
});

const cells = [];
for (let y = 0; y < ROWS; y += 1) {
  for (let x = 0; x < COLS; x += 1) {
    const lon = bbox.west + (x + 0.5) * lonStep;
    const lat = bbox.north - (y + 0.5) * latStep;
    const inside = booleanPointInPolygon(point([lon, lat]), boundary);
    cells.push({
      id: `${x}-${y}`,
      x,
      y,
      lon: Number(lon.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      outside: !inside,
      water: false,
      park: false,
      road: null,
      facility: null,
      transit: null,
      facilities: [],
    });
  }
}

const gridRangeForCoordinates = (coordinates) => {
  const lons = coordinates.map(([lon]) => lon);
  const lats = coordinates.map(([, lat]) => lat);
  const topLeft = lonLatToGrid(Math.min(...lons), Math.max(...lats));
  const bottomRight = lonLatToGrid(Math.max(...lons), Math.min(...lats));
  return {
    minX: Math.max(0, topLeft.x - 1),
    maxX: Math.min(COLS - 1, bottomRight.x + 1),
    minY: Math.max(0, topLeft.y - 1),
    maxY: Math.min(ROWS - 1, bottomRight.y + 1),
  };
};

const fillPolygon = (coordinates, field) => {
  if (coordinates.length < 4) return;
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) return;

  let polygonFeature;
  try {
    polygonFeature = polygon([coordinates]);
  } catch {
    return;
  }

  const range = gridRangeForCoordinates(coordinates);
  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      const cell = cells[indexOf(x, y)];
      if (cell.outside) continue;
      if (booleanPointInPolygon(point([cell.lon, cell.lat]), polygonFeature)) {
        cell[field] = true;
      }
    }
  }
};

const markLine = (coordinates, apply) => {
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = lonLatToGrid(...coordinates[index - 1]);
    const end = lonLatToGrid(...coordinates[index]);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * 4));
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const x = Math.round(start.x + (end.x - start.x) * progress);
      const y = Math.round(start.y + (end.y - start.y) * progress);
      const cell = cells[indexOf(x, y)];
      if (!cell.outside) apply(cell);
    }
  }
};

const geometriesFor = (element) => {
  if (element.geometry?.length) {
    return [element.geometry.map(({ lon, lat }) => [lon, lat])];
  }
  if (element.type === "relation") {
    return (element.members ?? [])
      .filter((member) => member.geometry?.length)
      .map((member) => member.geometry.map(({ lon, lat }) => [lon, lat]));
  }
  return [];
};

const majorRoads = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link",
]);
const minorRoads = new Set(["residential", "unclassified", "living_street", "pedestrian"]);

for (const element of osm.elements) {
  const tags = element.tags ?? {};
  const geometries = geometriesFor(element);
  const isWater = tags.natural === "water" || Boolean(tags.waterway);
  const isPark = Boolean(tags.leisure) || ["grass", "recreation_ground", "forest"].includes(tags.landuse);

  if (isWater) {
    for (const geometry of geometries) {
      fillPolygon(geometry, "water");
      markLine(geometry, (cell) => { cell.water = true; });
    }
  }

  if (isPark) {
    for (const geometry of geometries) fillPolygon(geometry, "park");
  }

  if (majorRoads.has(tags.highway) || minorRoads.has(tags.highway)) {
    const roadClass = majorRoads.has(tags.highway) ? "major" : "minor";
    for (const geometry of geometries) {
      markLine(geometry, (cell) => {
        if (roadClass === "major" || !cell.road) cell.road = roadClass;
      });
    }
  }
}

const representativePoint = (element) => {
  if (element.type === "node" && Number.isFinite(element.lon) && Number.isFinite(element.lat)) {
    return [element.lon, element.lat];
  }
  const coordinates = geometriesFor(element).flat();
  if (!coordinates.length) return null;
  return [
    coordinates.reduce((sum, [lon]) => sum + lon, 0) / coordinates.length,
    coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length,
  ];
};

const facilityKind = (tags) => {
  if (tags.shop === "mall") return "mall";
  if (["cafe", "food_court"].includes(tags.amenity)) return "cafe";
  if (["community_centre", "library"].includes(tags.amenity)) return "community";
  if (tags.amenity === "drinking_water") return "water";
  if (tags.amenity === "shelter") return "shelter";
  return null;
};

const facilityPriority = { mall: 5, community: 4, cafe: 3, water: 2, shelter: 1 };
const facilities = [];
const transitStations = [];

for (const element of osm.elements) {
  const tags = element.tags ?? {};
  const coordinates = representativePoint(element);
  if (!coordinates) continue;
  const [lon, lat] = coordinates;
  if (!booleanPointInPolygon(point([lon, lat]), boundary)) continue;
  const { x, y } = lonLatToGrid(lon, lat);
  const cell = cells[indexOf(x, y)];

  const kind = facilityKind(tags);
  if (kind) {
    const facility = {
      x,
      y,
      lon: Number(lon.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      kind,
      label: tags.name ?? ({ mall: "Shopping mall", cafe: "Cafe or food court", community: "Community facility", water: "Drinking water", shelter: "Shelter" })[kind],
    };
    facilities.push(facility);
    cell.facilities.push(facility);
    if (!cell.facility || facilityPriority[kind] > facilityPriority[cell.facility.kind]) {
      cell.facility = facility;
    }
  }

  if (["station", "halt"].includes(tags.railway) || tags.public_transport === "station") {
    const station = {
      x,
      y,
      lon: Number(lon.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      label: tags.name ?? "Rail station",
    };
    if (!transitStations.some((existing) => existing.x === x && existing.y === y)) {
      transitStations.push(station);
      cell.transit = station;
    }
  }
}

const placeCenters = [
  { label: "Dover", lon: 103.778, lat: 1.311 },
  { label: "Buona Vista", lon: 103.790, lat: 1.307 },
  { label: "one-north", lon: 103.787, lat: 1.299 },
  { label: "Commonwealth", lon: 103.798, lat: 1.302 },
  { label: "Queenstown", lon: 103.806, lat: 1.294 },
  { label: "Alexandra", lon: 103.803, lat: 1.286 },
  { label: "Kent Ridge", lon: 103.772, lat: 1.294 },
  { label: "Pasir Panjang", lon: 103.777, lat: 1.276 },
];

const gridDistance = (cell, location) => {
  const grid = lonLatToGrid(location.lon, location.lat);
  return Math.hypot(cell.x - grid.x, cell.y - grid.y);
};
const gaussian = (distance, spread) => Math.exp(-(distance ** 2) / (2 * spread ** 2));

const vulnerableCenters = [
  { lon: 103.806, lat: 1.294, weight: 1 },
  { lon: 103.798, lat: 1.302, weight: 0.82 },
  { lon: 103.787, lat: 1.310, weight: 0.66 },
  { lon: 103.801, lat: 1.286, weight: 0.7 },
];

for (const cell of cells) {
  if (cell.outside) {
    cell.zone = "Outside Queenstown";
    cell.heat = 0;
    cell.vulnerable = 0;
    cell.flow = 0;
    cell.cooling = 0;
    cell.buildable = false;
    delete cell.facilities;
    continue;
  }

  const closestPlace = placeCenters.reduce((best, location) => {
    const distance = gridDistance(cell, location);
    return distance < best.distance ? { label: location.label, distance } : best;
  }, { label: "Queenstown", distance: Infinity });
  cell.zone = closestPlace.label;

  const cooling = facilities.reduce(
    (best, facility) => Math.max(best, gaussian(Math.hypot(cell.x - facility.x, cell.y - facility.y), 2.25)),
    0,
  );
  const transitFlow = transitStations.reduce(
    (best, station) => Math.max(best, gaussian(Math.hypot(cell.x - station.x, cell.y - station.y), 3)),
    0,
  );
  const communityFlow = Math.max(
    gaussian(gridDistance(cell, placeCenters[1]), 5),
    gaussian(gridDistance(cell, placeCenters[2]), 4.5),
    gaussian(gridDistance(cell, placeCenters[4]), 4.5),
  );
  const vulnerability = vulnerableCenters.reduce(
    (best, location) => Math.max(best, gaussian(gridDistance(cell, location), 4.4) * location.weight),
    0,
  );

  cell.heat = Number(clamp(0.36 + (cell.road === "major" ? 0.34 : cell.road === "minor" ? 0.17 : 0) - (cell.park ? 0.28 : 0) - (cell.water ? 0.5 : 0)).toFixed(3));
  cell.vulnerable = Number(clamp(0.08 + vulnerability * 0.88).toFixed(3));
  cell.flow = Number(clamp(0.06 + transitFlow * 0.66 + communityFlow * 0.28 + (cell.road === "major" ? 0.18 : cell.road === "minor" ? 0.08 : 0)).toFixed(3));
  cell.cooling = Number(clamp(cooling).toFixed(3));
  cell.buildable = !cell.water && cell.road !== "major" && !cell.facility && !cell.transit;
  delete cell.facilities;
}

const labels = placeCenters.map((location) => {
  const { x, y } = lonLatToGrid(location.lon, location.lat);
  return { label: location.label, x, y };
});

const compactCells = cells.map((cell) => {
  if (cell.outside) {
    return { id: cell.id, x: cell.x, y: cell.y, outside: true };
  }

  return {
    id: cell.id,
    x: cell.x,
    y: cell.y,
    lon: cell.lon,
    lat: cell.lat,
    zone: cell.zone,
    water: cell.water || undefined,
    park: cell.park || undefined,
    road: cell.road || undefined,
    facility: cell.facility
      ? { kind: cell.facility.kind, label: cell.facility.label }
      : undefined,
    transit: cell.transit ? { label: cell.transit.label } : undefined,
    heat: cell.heat,
    vulnerable: cell.vulnerable,
    flow: cell.flow,
    cooling: cell.cooling,
    buildable: cell.buildable,
  };
});

const output = {
  metadata: {
    title: "Queenstown Planning Area",
    generatedAt: new Date().toISOString(),
    columns: COLS,
    rows: ROWS,
    cellSizeMetres,
    bbox,
    boundarySource: {
      name: "Master Plan 2019 Planning Area Boundary (No Sea)",
      agency: "Urban Redevelopment Authority",
      datasetId: "d_4765db0e87b9c86336792efe8a1f7a66",
      url: "https://data.gov.sg/collections/2104/view",
    },
    featureSource: {
      name: "OpenStreetMap via Overpass API",
      attribution: "© OpenStreetMap contributors",
      license: "ODbL 1.0",
      url: "https://www.openstreetmap.org/copyright",
    },
    modelNote: "Boundary and physical features are GIS-derived. Heat and vulnerable-population scores are modelling proxies, not official measurements.",
    counts: {
      osmElements: osm.elements.length,
      facilities: facilities.length,
      transitStations: transitStations.length,
      insideCells: cells.filter((cell) => !cell.outside).length,
    },
  },
  labels,
  cells: compactCells,
};

fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);
console.log(`Generated ${outputPath}`);
console.log(output.metadata);
