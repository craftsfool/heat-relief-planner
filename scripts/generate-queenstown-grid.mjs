import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bbox as turfBbox,
  booleanPointInPolygon,
  point,
  pointOnFeature,
  polygon,
} from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(projectRoot, "src/data/queenstownGrid.json");
const subzoneDatasetId = "d_8594ae9ff96d0c708bc2af633048edfb";
const cellSizeMetres = 20;
const osmBbox = "1.255012,103.750225,1.318733,103.816599";

const loadJson = async (filePath, url, options) => {
  if (filePath) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Unable to fetch ${url}: ${response.status}`);
  const data = await response.json();
  if (data?.data?.url) {
    const download = await fetch(data.data.url);
    if (!download.ok) throw new Error(`Unable to download dataset from ${data.data.url}: ${download.status}`);
    return download.json();
  }
  return data;
};

const subzonesCollection = await loadJson(
  process.env.QUEENSTOWN_SUBZONES,
  `https://api-open.data.gov.sg/v1/public/api/datasets/${subzoneDatasetId}/poll-download`,
);

const osmQuery = `[out:json][timeout:240];(
way["highway"](${osmBbox});
way["building"](${osmBbox});relation["building"](${osmBbox});
nwr["natural"="water"](${osmBbox});way["waterway"](${osmBbox});
nwr["leisure"~"park|garden|nature_reserve|pitch"](${osmBbox});
nwr["landuse"~"forest|grass|meadow|recreation_ground|cemetery|construction"](${osmBbox});
nwr["natural"~"wood|wetland|scrub"](${osmBbox});
nwr["railway"~"station|halt|tram_stop"](${osmBbox});
nwr["public_transport"="station"](${osmBbox});
nwr["shop"~"mall|supermarket|convenience"](${osmBbox});
nwr["amenity"~"cafe|food_court|community_centre|library|drinking_water|shelter"](${osmBbox});
);out geom;`;
const osm = await loadJson(
  process.env.QUEENSTOWN_OSM,
  "https://overpass.private.coffee/api/interpreter",
  {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "user-agent": "HeatReliefPlanner/1.0",
    },
    body: `data=${encodeURIComponent(osmQuery)}`,
  },
);

const titleCase = (value) => value
  .toLowerCase()
  .replace(/(^|[\s-])\w/g, (match) => match.toUpperCase());
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const gaussian = (distance, spread) => Math.exp(-(distance ** 2) / (2 * spread ** 2));

const subzoneFeatures = subzonesCollection.features
  .filter((feature) => feature.properties.PLN_AREA_N === "QUEENSTOWN")
  .sort((a, b) => a.properties.SUBZONE_NO - b.properties.SUBZONE_NO);
if (subzoneFeatures.length !== 15) throw new Error(`Expected 15 Queenstown subzones, found ${subzoneFeatures.length}`);

const bounds = subzoneFeatures.reduce((current, feature) => {
  const [west, south, east, north] = turfBbox(feature);
  return {
    west: Math.min(current.west, west), south: Math.min(current.south, south),
    east: Math.max(current.east, east), north: Math.max(current.north, north),
  };
}, { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity });
const meanLatitudeRadians = ((bounds.north + bounds.south) / 2) * Math.PI / 180;
const lonStep = cellSizeMetres / (111_320 * Math.cos(meanLatitudeRadians));
const latStep = cellSizeMetres / 110_574;
const columns = Math.ceil((bounds.east - bounds.west) / lonStep);
const rows = Math.ceil((bounds.north - bounds.south) / latStep);

const subzoneRecords = subzoneFeatures.map((feature) => {
  const [west, south, east, north] = turfBbox(feature);
  return {
    feature,
    code: feature.properties.SUBZONE_C,
    name: titleCase(feature.properties.SUBZONE_N),
    number: feature.properties.SUBZONE_NO,
    bbox: { west, south, east, north },
    labelPoint: pointOnFeature(feature).geometry.coordinates,
  };
});

const cells = [];
const cellByCoordinate = new Map();
const lonLatToGrid = (lon, lat) => ({
  x: clamp(Math.floor((lon - bounds.west) / lonStep), 0, columns - 1),
  y: clamp(Math.floor((bounds.north - lat) / latStep), 0, rows - 1),
});

for (let y = 0; y < rows; y += 1) {
  const lat = bounds.north - (y + 0.5) * latStep;
  for (let x = 0; x < columns; x += 1) {
    const lon = bounds.west + (x + 0.5) * lonStep;
    const subzoneIndex = subzoneRecords.findIndex((record) => (
      lon >= record.bbox.west && lon <= record.bbox.east &&
      lat >= record.bbox.south && lat <= record.bbox.north &&
      booleanPointInPolygon(point([lon, lat]), record.feature)
    ));
    if (subzoneIndex < 0) continue;
    const cell = {
      id: `${x}-${y}`, x, y, lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)), subzoneIndex,
      water: false, park: false, building: false, construction: false,
      road: null, facility: false, transit: false, cooling: 0, transitFlow: 0,
    };
    cells.push(cell);
    cellByCoordinate.set(cell.id, cell);
  }
}

const geometryCoordinates = (element) => {
  if (element.geometry?.length) return [element.geometry.map(({ lon, lat }) => [lon, lat])];
  if (element.type === "relation") {
    return (element.members ?? [])
      .filter((member) => member.geometry?.length)
      .map((member) => member.geometry.map(({ lon, lat }) => [lon, lat]));
  }
  return [];
};

const gridRange = (coordinates, padding = 1) => {
  const lons = coordinates.map(([lon]) => lon);
  const lats = coordinates.map(([, lat]) => lat);
  const topLeft = lonLatToGrid(Math.min(...lons), Math.max(...lats));
  const bottomRight = lonLatToGrid(Math.max(...lons), Math.min(...lats));
  return {
    minX: Math.max(0, topLeft.x - padding), maxX: Math.min(columns - 1, bottomRight.x + padding),
    minY: Math.max(0, topLeft.y - padding), maxY: Math.min(rows - 1, bottomRight.y + padding),
  };
};

const fillPolygon = (coordinates, apply) => {
  if (coordinates.length < 4) return;
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) return;
  let feature;
  try { feature = polygon([coordinates]); } catch { return; }
  const range = gridRange(coordinates);
  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      const cell = cellByCoordinate.get(`${x}-${y}`);
      if (cell && booleanPointInPolygon(point([cell.lon, cell.lat]), feature)) apply(cell);
    }
  }
};

const markLine = (coordinates, radius, apply) => {
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = lonLatToGrid(...coordinates[index - 1]);
    const end = lonLatToGrid(...coordinates[index]);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * 3));
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const centerX = Math.round(start.x + (end.x - start.x) * progress);
      const centerY = Math.round(start.y + (end.y - start.y) * progress);
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const cell = cellByCoordinate.get(`${centerX + offsetX}-${centerY + offsetY}`);
          if (cell) apply(cell);
        }
      }
    }
  }
};

const majorRoads = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const minorRoads = new Set(["tertiary", "tertiary_link", "residential", "unclassified", "living_street", "pedestrian", "service"]);
let buildings = 0;
let waterFeatures = 0;
let greenFeatures = 0;
let roadFeatures = 0;

for (const element of osm.elements) {
  const tags = element.tags ?? {};
  const geometries = geometryCoordinates(element);
  const isWater = tags.natural === "water" || Boolean(tags.waterway);
  const isGreen = Boolean(tags.leisure?.match(/park|garden|nature_reserve|pitch/)) ||
    ["forest", "grass", "meadow", "recreation_ground", "cemetery"].includes(tags.landuse) ||
    ["wood", "wetland", "scrub"].includes(tags.natural);
  const isConstruction = tags.landuse === "construction";
  const roadClass = majorRoads.has(tags.highway) ? "major" : minorRoads.has(tags.highway) ? "minor" : null;

  if (tags.building) {
    buildings += 1;
    for (const geometry of geometries) fillPolygon(geometry, (cell) => { cell.building = true; });
  }
  if (isWater) {
    waterFeatures += 1;
    for (const geometry of geometries) {
      fillPolygon(geometry, (cell) => { cell.water = true; });
      if (tags.waterway) markLine(geometry, 0, (cell) => { cell.water = true; });
    }
  }
  if (isGreen) {
    greenFeatures += 1;
    for (const geometry of geometries) fillPolygon(geometry, (cell) => { cell.park = true; });
  }
  if (isConstruction) {
    for (const geometry of geometries) fillPolygon(geometry, (cell) => { cell.construction = true; });
  }
  if (roadClass) {
    roadFeatures += 1;
    for (const geometry of geometries) markLine(geometry, roadClass === "major" ? 1 : 0, (cell) => {
      if (roadClass === "major" || !cell.road) cell.road = roadClass;
    });
  }
}

const representativePoint = (element) => {
  if (Number.isFinite(element.lon) && Number.isFinite(element.lat)) return [element.lon, element.lat];
  if (element.center) return [element.center.lon, element.center.lat];
  const coordinates = geometryCoordinates(element).flat();
  if (!coordinates.length) return null;
  return [
    coordinates.reduce((sum, [lon]) => sum + lon, 0) / coordinates.length,
    coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length,
  ];
};

const facilities = [];
const transitStations = [];
const facilityKind = (tags) => {
  if (tags.shop === "mall") return "mall";
  if (tags.shop === "supermarket") return "supermarket";
  if (tags.shop === "convenience") return "convenience";
  if (tags.amenity === "cafe") return "cafe";
  if (tags.amenity === "food_court") return "food_court";
  if (tags.amenity === "community_centre") return "community";
  if (tags.amenity === "library") return "library";
  if (tags.amenity === "drinking_water") return "water";
  if (tags.amenity === "shelter") return "shelter";
  return null;
};

for (const element of osm.elements) {
  const tags = element.tags ?? {};
  const coordinates = representativePoint(element);
  if (!coordinates) continue;
  const { x, y } = lonLatToGrid(...coordinates);
  const cell = cellByCoordinate.get(`${x}-${y}`);
  if (!cell) continue;
  const kind = facilityKind(tags);
  if (kind) {
    const facility = {
      osmId: `${element.type}/${element.id}`,
      x,
      y,
      lon: Number(coordinates[0].toFixed(6)),
      lat: Number(coordinates[1].toFixed(6)),
      kind,
      label: tags.name ?? kind.replaceAll("_", " "),
    };
    facilities.push(facility);
    cell.facility = true;
  }
  if (["station", "halt", "tram_stop"].includes(tags.railway) || tags.public_transport === "station") {
    if (!transitStations.some((station) => station.x === x && station.y === y)) {
      transitStations.push({ x, y, label: tags.name ?? "Transit station" });
      cell.transit = true;
    }
  }
}

const facilityService = {
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
const uniqueFacilities = new Map();
for (const facility of facilities) {
  const key = `${facility.x}-${facility.y}:${facility.kind}:${facility.label.toLowerCase()}`;
  if (!uniqueFacilities.has(key)) uniqueFacilities.set(key, facility);
}
const existingSheltersByCell = new Map();
for (const facility of uniqueFacilities.values()) {
  const service = facilityService[facility.kind];
  const key = `${facility.x}-${facility.y}`;
  const current = existingSheltersByCell.get(key) ?? {
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
  if (service.capacity > facilityService[current.kind].capacity) {
    current.kind = facility.kind;
    current.label = facility.label;
  }
  existingSheltersByCell.set(key, current);
}
const existingShelters = [...existingSheltersByCell.values()]
  .map((shelter) => ({
    ...shelter,
    label: shelter.facilityCount > 1
      ? `${shelter.label} + ${shelter.facilityCount - 1} nearby`
      : shelter.label,
  }))
  .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));

const spreadInfluence = (locations, spreadMetres, apply) => {
  const reach = Math.ceil((spreadMetres * 3) / cellSizeMetres);
  for (const location of locations) {
    for (let offsetY = -reach; offsetY <= reach; offsetY += 1) {
      for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
        const cell = cellByCoordinate.get(`${location.x + offsetX}-${location.y + offsetY}`);
        if (!cell) continue;
        const distance = Math.hypot(offsetX, offsetY) * cellSizeMetres;
        apply(cell, gaussian(distance, spreadMetres), location);
      }
    }
  }
};
spreadInfluence(facilities, 260, (cell, influence) => { cell.cooling = Math.max(cell.cooling, influence); });
spreadInfluence(transitStations, 360, (cell, influence) => { cell.transitFlow = Math.max(cell.transitFlow, influence); });

const modelCenters = [
  { lon: 103.806, lat: 1.294, vulnerable: 1, flow: 0.7 },
  { lon: 103.798, lat: 1.302, vulnerable: 0.82, flow: 0.85 },
  { lon: 103.787, lat: 1.310, vulnerable: 0.66, flow: 0.72 },
  { lon: 103.801, lat: 1.286, vulnerable: 0.7, flow: 0.65 },
  { lon: 103.787, lat: 1.299, vulnerable: 0.35, flow: 0.9 },
].map((center) => ({ ...center, ...lonLatToGrid(center.lon, center.lat) }));

for (const cell of cells) {
  const vulnerable = modelCenters.reduce((best, center) => Math.max(
    best,
    gaussian(Math.hypot(cell.x - center.x, cell.y - center.y) * cellSizeMetres, 700) * center.vulnerable,
  ), 0);
  const communityFlow = modelCenters.reduce((best, center) => Math.max(
    best,
    gaussian(Math.hypot(cell.x - center.x, cell.y - center.y) * cellSizeMetres, 780) * center.flow,
  ), 0);
  cell.heat = Number(clamp(
    0.32 + (cell.building ? 0.18 : 0) + (cell.construction ? 0.3 : 0) +
    (cell.road === "major" ? 0.36 : cell.road === "minor" ? 0.16 : 0) -
    (cell.park ? 0.3 : 0) - (cell.water ? 0.55 : 0),
  ).toFixed(3));
  cell.vulnerable = Number(clamp(0.06 + vulnerable * 0.9).toFixed(3));
  cell.flow = Number(clamp(
    0.05 + cell.transitFlow * 0.64 + communityFlow * 0.25 +
    (cell.road === "major" ? 0.16 : cell.road === "minor" ? 0.07 : 0),
  ).toFixed(3));
  cell.cooling = Number(clamp(cell.cooling).toFixed(3));
  cell.buildable = !cell.water && !cell.building && !cell.construction && !cell.road && !cell.facility && !cell.transit;
}

const subzoneCounts = new Map();
for (const cell of cells) subzoneCounts.set(cell.subzoneIndex, (subzoneCounts.get(cell.subzoneIndex) ?? 0) + 1);
const subzones = subzoneRecords.map((record, index) => {
  const x = clamp(Math.floor((record.labelPoint[0] - bounds.west) / lonStep), 0, columns - 1);
  const y = clamp(Math.floor((bounds.north - record.labelPoint[1]) / latStep), 0, rows - 1);
  return {
    code: record.code, name: record.name, number: record.number, x, y,
    bounds: {
      minX: clamp(Math.floor((record.bbox.west - bounds.west) / lonStep), 0, columns - 1),
      maxX: clamp(Math.ceil((record.bbox.east - bounds.west) / lonStep), 0, columns - 1),
      minY: clamp(Math.floor((bounds.north - record.bbox.north) / latStep), 0, rows - 1),
      maxY: clamp(Math.ceil((bounds.north - record.bbox.south) / latStep), 0, rows - 1),
    },
    cellCount: subzoneCounts.get(index) ?? 0,
  };
});

const packedCells = cells.map((cell) => {
  const flags = (cell.water ? 1 : 0) | (cell.park ? 2 : 0) |
    (cell.road === "major" ? 4 : 0) | (cell.road === "minor" ? 8 : 0) |
    (cell.buildable ? 16 : 0) | (cell.building ? 32 : 0) |
    (cell.construction ? 64 : 0) | (cell.facility ? 128 : 0) | (cell.transit ? 256 : 0);
  return [cell.x, cell.y, cell.lon, cell.lat, cell.subzoneIndex, flags, cell.heat, cell.vulnerable, cell.flow, cell.cooling];
});

const output = {
  metadata: {
    title: "Queenstown Planning Area", generatedAt: new Date().toISOString(),
    columns, rows, cellSizeMetres,
    cellFormat: ["x", "y", "lon", "lat", "subzoneIndex", "flags", "heat", "vulnerable", "flow", "cooling"],
    bbox: bounds,
    boundarySource: {
      name: "Master Plan 2019 Subzone Boundary (No Sea)", agency: "Urban Redevelopment Authority",
      datasetId: subzoneDatasetId, url: `https://data.gov.sg/datasets/${subzoneDatasetId}/view`,
    },
    featureSource: {
      name: "OpenStreetMap via Overpass API", attribution: "© OpenStreetMap contributors",
      license: "ODbL 1.0", url: "https://www.openstreetmap.org/copyright",
    },
    modelNote: "URA subzone boundaries and OpenStreetMap physical features are independently rasterised at 20 m. Heat and vulnerable-population scores are modelling proxies, not official measurements.",
    counts: {
      subzones: subzones.length, insideCells: cells.length,
      buildableCells: cells.filter((cell) => cell.buildable).length,
      buildings, waterFeatures, greenFeatures, roadFeatures,
      facilities: uniqueFacilities.size,
      existingShelterCells: existingShelters.length,
      existingShelterCapacity: existingShelters.reduce((sum, shelter) => sum + shelter.capacity, 0),
      transitStations: transitStations.length,
    },
  },
  subzones,
  existingShelters,
  cells: packedCells,
};

fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);
console.log(`Generated ${outputPath}`);
console.log(output.metadata);
