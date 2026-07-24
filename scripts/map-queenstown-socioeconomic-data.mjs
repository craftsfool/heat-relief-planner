import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const gridPath = path.join(projectRoot, "src/data/queenstownGrid.json");
const sourceOutputPath = path.join(projectRoot, "src/data/queenstownSocioeconomic.json");

const populationDatasetId = "d_d95ae740c0f8961a0b10435836660ce0";
const housingDatasetId = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";
const populationUrl =
  `https://data.gov.sg/api/action/datastore_search?resource_id=${populationDatasetId}&limit=500`;
const housingUrl =
  "https://data.gov.sg/api/action/datastore_search?" +
  `resource_id=${housingDatasetId}&limit=10000&filters=${encodeURIComponent('{"town":"QUEENSTOWN"}')}`;
const oneMapUrl = "https://www.onemap.gov.sg/api/common/elastic/search";
const seniorColumns = [
  "Total_65_69",
  "Total_70_74",
  "Total_75_79",
  "Total_80_84",
  "Total_85_89",
  "Total_90andOver",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const parseCount = (value) => Number(String(value).replaceAll(",", "")) || 0;
const titleCase = (value) => value
  .toLowerCase()
  .replace(/(^|[\s-])\w/g, (match) => match.toUpperCase());
const normalizeName = (value) => titleCase(value)
  .replace("One-North", "One North")
  .replace("S’pore", "S'pore");

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const fetchJson = async (url, attempts = 4) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "HeatReliefPlanner/1.0 (NUS modelling project)" },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(350 * attempt);
    }
  }
  throw new Error(`Unable to fetch ${url}: ${lastError?.message}`);
};
const loadApiData = async (environmentPath, url) => (
  environmentPath ? readJson(environmentPath) : fetchJson(url)
);

const monthOffset = (month, offset) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const grid = readJson(gridPath);
const existingSourceData = fs.existsSync(sourceOutputPath) ? readJson(sourceOutputPath) : null;
const cellFormat = grid.metadata.cellFormat;
const fieldIndex = Object.fromEntries(cellFormat.map((field, index) => [field, index]));
const cells = grid.cells.map((packed) => ({
  packed,
  x: packed[fieldIndex.x],
  y: packed[fieldIndex.y],
  lon: packed[fieldIndex.lon],
  lat: packed[fieldIndex.lat],
  subzoneIndex: packed[fieldIndex.subzoneIndex],
  flags: packed[fieldIndex.flags],
}));
const cellById = new Map(cells.map((cell) => [`${cell.x}-${cell.y}`, cell]));
const cellSizeMetres = grid.metadata.cellSizeMetres;
const { west, north } = grid.metadata.bbox;
const meanLatitudeRadians =
  ((grid.metadata.bbox.north + grid.metadata.bbox.south) / 2) * Math.PI / 180;
const lonStep = cellSizeMetres / (111_320 * Math.cos(meanLatitudeRadians));
const latStep = cellSizeMetres / 110_574;
const coordinateToGrid = (lon, lat) => ({
  x: Math.floor((lon - west) / lonStep),
  y: Math.floor((north - lat) / latStep),
});
const nearestInsideCell = (lon, lat) => {
  const origin = coordinateToGrid(lon, lat);
  for (let radius = 0; radius <= 5; radius += 1) {
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

const populationApi = await loadApiData(process.env.QUEENSTOWN_POPULATION, populationUrl);
const populationRecords = populationApi.result?.records ?? [];
const planningAreaPopulationRecord = populationRecords.find(
  (record) => record.Number === "Queenstown - Total",
);
const reportedPlanningAreaPopulation = parseCount(planningAreaPopulationRecord?.Total_Total);
const populationBySubzone = new Map();
for (const record of populationRecords) {
  if (record.Number === "Queenstown - Total") continue;
  const name = normalizeName(record.Number);
  const subzoneIndex = grid.subzones.findIndex((subzone) => normalizeName(subzone.name) === name);
  if (subzoneIndex < 0) continue;
  populationBySubzone.set(subzoneIndex, {
    code: grid.subzones[subzoneIndex].code,
    name: grid.subzones[subzoneIndex].name,
    population: parseCount(record.Total_Total),
    seniors65Plus: seniorColumns.reduce((sum, column) => sum + parseCount(record[column]), 0),
  });
}
if (populationBySubzone.size !== grid.subzones.length) {
  const missing = grid.subzones
    .filter((_, index) => !populationBySubzone.has(index))
    .map((subzone) => subzone.name);
  throw new Error(`Population rows missing for: ${missing.join(", ")}`);
}

const housingApi = await loadApiData(process.env.QUEENSTOWN_HOUSING, housingUrl);
const housingRecords = housingApi.result?.records ?? [];
const latestHousingMonth = housingRecords
  .map((record) => record.month)
  .filter(Boolean)
  .sort()
  .at(-1);
if (!latestHousingMonth) throw new Error("No Queenstown HDB resale records found");
const firstHousingMonth = monthOffset(latestHousingMonth, -23);
const recentHousingRecords = housingRecords.filter(
  (record) => record.month >= firstHousingMonth && record.month <= latestHousingMonth,
);

const transactionGroups = new Map();
for (const record of recentHousingRecords) {
  const floorArea = Number(record.floor_area_sqm);
  const price = Number(record.resale_price);
  if (!(floorArea > 0 && price > 0)) continue;
  const address = `${record.block} ${record.street_name}`.trim();
  const group = transactionGroups.get(address) ?? {
    address,
    block: record.block,
    streetName: record.street_name,
    prices: [],
    pricesPsm: [],
    months: [],
  };
  group.prices.push(price);
  group.pricesPsm.push(price / floorArea);
  group.months.push(record.month);
  transactionGroups.set(address, group);
}

const cachedCoordinates = new Map(
  (existingSourceData?.housing?.pricePoints ?? []).map((item) => [item.address, item]),
);
const geocodeAddress = async (group) => {
  const cached = cachedCoordinates.get(group.address);
  if (cached?.lon && cached?.lat) return { lon: cached.lon, lat: cached.lat, postal: cached.postal };
  const query = new URLSearchParams({
    searchVal: group.address,
    returnGeom: "Y",
    getAddrDetails: "Y",
    pageNum: "1",
  });
  const data = await fetchJson(`${oneMapUrl}?${query}`);
  const result = (data.results ?? []).find(
    (candidate) => candidate.BLK_NO === group.block,
  ) ?? data.results?.[0];
  if (!result) return null;
  return {
    lon: Number(result.LONGITUDE),
    lat: Number(result.LATITUDE),
    postal: result.POSTAL || "",
  };
};

const groups = [...transactionGroups.values()].sort((a, b) => a.address.localeCompare(b.address));
const pricePoints = [];
for (let index = 0; index < groups.length; index += 1) {
  const group = groups[index];
  const coordinates = await geocodeAddress(group);
  if (!coordinates || !Number.isFinite(coordinates.lon) || !Number.isFinite(coordinates.lat)) {
    console.warn(`OneMap did not resolve: ${group.address}`);
    continue;
  }
  const gridCell = nearestInsideCell(coordinates.lon, coordinates.lat);
  if (!gridCell) {
    console.warn(`Address falls outside Queenstown grid: ${group.address}`);
    continue;
  }
  pricePoints.push({
    address: group.address,
    postal: coordinates.postal,
    lon: Number(coordinates.lon.toFixed(7)),
    lat: Number(coordinates.lat.toFixed(7)),
    x: gridCell.x,
    y: gridCell.y,
    subzoneCode: grid.subzones[gridCell.subzoneIndex].code,
    transactionCount: group.prices.length,
    medianPrice: Math.round(median(group.prices)),
    medianPricePsm: Math.round(median(group.pricesPsm)),
    latestMonth: group.months.sort().at(-1),
  });
  if (!cachedCoordinates.has(group.address)) await sleep(80);
}
if (!pricePoints.length) throw new Error("OneMap did not resolve any Queenstown HDB addresses");

const gaussian = (distanceMetres, spreadMetres) =>
  Math.exp(-(distanceMetres ** 2) / (2 * spreadMetres ** 2));
const distributeIntegerTotal = (eligibleCells, total, weightForCell) => {
  if (!eligibleCells.length || total <= 0) return new Map();
  const weights = eligibleCells.map((cell) => Math.max(0.0001, weightForCell(cell)));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const allocations = eligibleCells.map((cell, index) => {
    const exact = total * weights[index] / weightSum;
    return { cell, value: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let unassigned = total - allocations.reduce((sum, item) => sum + item.value, 0);
  allocations.sort((a, b) => b.remainder - a.remainder || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
  for (let index = 0; index < unassigned; index += 1) allocations[index].value += 1;
  return new Map(allocations.map((item) => [`${item.cell.x}-${item.cell.y}`, item.value]));
};

const populationValues = new Map();
const seniorValues = new Map();
for (let subzoneIndex = 0; subzoneIndex < grid.subzones.length; subzoneIndex += 1) {
  const source = populationBySubzone.get(subzoneIndex);
  const subzoneCells = cells.filter((cell) => cell.subzoneIndex === subzoneIndex && !(cell.flags & 1));
  const buildingCells = subzoneCells.filter((cell) => cell.flags & 32);
  const eligibleCells = buildingCells.length ? buildingCells : subzoneCells;
  const localPricePoints = pricePoints.filter((pricePoint) => pricePoint.subzoneCode === source.code);
  const residentialWeight = (cell) => {
    if (!localPricePoints.length) return 1;
    const addressSignal = localPricePoints.reduce((sum, pricePoint) => {
      const distance = Math.hypot(cell.x - pricePoint.x, cell.y - pricePoint.y) * cellSizeMetres;
      return sum + gaussian(distance, 120) * Math.log1p(pricePoint.transactionCount);
    }, 0);
    return 0.12 + addressSignal;
  };
  const distributedPopulation = distributeIntegerTotal(
    eligibleCells,
    source.population,
    residentialWeight,
  );
  const distributedSeniors = distributeIntegerTotal(
    eligibleCells,
    source.seniors65Plus,
    residentialWeight,
  );
  for (const cell of eligibleCells) {
    const id = `${cell.x}-${cell.y}`;
    populationValues.set(id, distributedPopulation.get(id) ?? 0);
    seniorValues.set(id, Math.min(
      distributedPopulation.get(id) ?? 0,
      distributedSeniors.get(id) ?? 0,
    ));
  }
}

const transactionMedianPricePsm = Math.round(median(
  recentHousingRecords.map((record) => Number(record.resale_price) / Number(record.floor_area_sqm)),
));
const nearestPricePoints = (cell, count = 8) => {
  const nearest = [];
  for (const pricePoint of pricePoints) {
    const distanceSquared = (cell.x - pricePoint.x) ** 2 + (cell.y - pricePoint.y) ** 2;
    const item = { pricePoint, distanceSquared };
    const insertionIndex = nearest.findIndex((other) => distanceSquared < other.distanceSquared);
    if (insertionIndex < 0) nearest.push(item);
    else nearest.splice(insertionIndex, 0, item);
    if (nearest.length > count) nearest.pop();
  }
  return nearest;
};
const mappedHousingPrice = (cell) => {
  if (cell.flags & 1) return { pricePsm: 0, costIndex: 0 };
  const nearest = nearestPricePoints(cell);
  let weightedPrice = 0;
  let weightSum = 0;
  for (const { pricePoint, distanceSquared } of nearest) {
    const weight = pricePoint.transactionCount / (distanceSquared + 4);
    weightedPrice += pricePoint.medianPricePsm * weight;
    weightSum += weight;
  }
  const pricePsm = Math.round(weightedPrice / weightSum);
  const costIndex = Number(Math.min(1.6, Math.max(0.6, pricePsm / transactionMedianPricePsm)).toFixed(3));
  return { pricePsm, costIndex };
};

const appendedFields = ["population", "seniorPopulation", "housingPricePsm", "housingCostIndex"];
for (const field of appendedFields) {
  if (!grid.metadata.cellFormat.includes(field)) grid.metadata.cellFormat.push(field);
}
const outputFieldIndex = Object.fromEntries(grid.metadata.cellFormat.map((field, index) => [field, index]));
for (const cell of cells) {
  const id = `${cell.x}-${cell.y}`;
  const housing = mappedHousingPrice(cell);
  cell.packed[outputFieldIndex.population] = populationValues.get(id) ?? 0;
  cell.packed[outputFieldIndex.seniorPopulation] = seniorValues.get(id) ?? 0;
  cell.packed[outputFieldIndex.housingPricePsm] = housing.pricePsm;
  cell.packed[outputFieldIndex.housingCostIndex] = housing.costIndex;
}

const sourceData = {
  generatedAt: new Date().toISOString(),
  population: {
    datasetId: populationDatasetId,
    datasetName: "Singapore Residents by Planning Area/Subzone, Age Group and Sex, Census of Population 2020",
    agency: "Singapore Department of Statistics",
    url: `https://data.gov.sg/datasets/${populationDatasetId}/view`,
    geography: "URA Master Plan 2019 subzones",
    reportedPlanningAreaPopulation,
    summedSubzonePopulation: [...populationBySubzone.values()]
      .reduce((sum, item) => sum + item.population, 0),
    roundingDifference:
      [...populationBySubzone.values()].reduce((sum, item) => sum + item.population, 0) -
      reportedPlanningAreaPopulation,
    allocationMethod:
      "Subzone totals are conserved and allocated to OSM building cells. Recent HDB address density supplies a residential weighting within each subzone. Published counts are rounded to the nearest ten, so summed subzones can differ slightly from the planning-area total.",
    subzones: grid.subzones.map((_, index) => populationBySubzone.get(index)),
  },
  housing: {
    datasetId: housingDatasetId,
    datasetName: "Resale flat prices based on registration date from Jan-2017 onwards",
    agency: "Housing & Development Board",
    url: `https://data.gov.sg/datasets/${housingDatasetId}/view`,
    dateRange: { from: firstHousingMonth, to: latestHousingMonth },
    transactionCount: recentHousingRecords.length,
    geocodingSource: {
      name: "OneMap Search API",
      agency: "Singapore Land Authority",
      url: "https://www.onemap.gov.sg/apidocs/search",
    },
    interpolationMethod:
      "Median resale price per square metre is calculated per HDB block, then mapped to all land cells using inverse-distance weighting from the eight nearest geocoded blocks.",
    queenstownMedianPricePsm: transactionMedianPricePsm,
    limitation:
      "This is an HDB resale-price proxy for local construction/land-cost pressure. It is not a private-property valuation or official land price.",
    pricePoints,
  },
};

grid.metadata.socioeconomicSource = {
  populationDatasetId,
  housingDatasetId,
  generatedAt: sourceData.generatedAt,
  populationTotal: sourceData.population.subzones.reduce((sum, item) => sum + item.population, 0),
  seniorPopulationTotal: sourceData.population.subzones.reduce((sum, item) => sum + item.seniors65Plus, 0),
  housingDateRange: sourceData.housing.dateRange,
  housingTransactionCount: sourceData.housing.transactionCount,
  housingPricePointCount: pricePoints.length,
  queenstownMedianPricePsm: transactionMedianPricePsm,
};
grid.metadata.modelNote =
  "URA/OSM physical features are rasterised at 20 m. Population uses official Census 2020 MP2019-subzone totals; housing cost uses recent official HDB resale transactions geocoded by OneMap. Heat and pedestrian-flow scores remain modelling proxies.";

for (let subzoneIndex = 0; subzoneIndex < grid.subzones.length; subzoneIndex += 1) {
  const source = populationBySubzone.get(subzoneIndex);
  const mappedPopulation = cells
    .filter((cell) => cell.subzoneIndex === subzoneIndex)
    .reduce((sum, cell) => sum + cell.packed[outputFieldIndex.population], 0);
  const mappedSeniors = cells
    .filter((cell) => cell.subzoneIndex === subzoneIndex)
    .reduce((sum, cell) => sum + cell.packed[outputFieldIndex.seniorPopulation], 0);
  if (mappedPopulation !== source.population || mappedSeniors !== source.seniors65Plus) {
    throw new Error(
      `${source.name} population allocation failed: ` +
      `${mappedPopulation}/${source.population}, seniors ${mappedSeniors}/${source.seniors65Plus}`,
    );
  }
}

fs.writeFileSync(sourceOutputPath, `${JSON.stringify(sourceData, null, 2)}\n`);
fs.writeFileSync(gridPath, `${JSON.stringify(grid)}\n`);

console.log(`Mapped socioeconomic data to ${cells.length.toLocaleString()} Queenstown cells`);
console.log({
  populationTotal: grid.metadata.socioeconomicSource.populationTotal,
  seniorPopulationTotal: grid.metadata.socioeconomicSource.seniorPopulationTotal,
  housingDateRange: sourceData.housing.dateRange,
  housingTransactions: recentHousingRecords.length,
  geocodedPricePoints: pricePoints.length,
  queenstownMedianPricePsm: transactionMedianPricePsm,
});
