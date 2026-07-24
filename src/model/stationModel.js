export const FIXED_SERVICE_RADIUS = 300;
export const STATION_CAPACITIES = Object.freeze([
  500,
  1000,
  1500,
  2000,
  2500,
  3000,
  3500,
  4000,
  4500,
]);
export const DEFAULT_STATION_CAPACITY = 1000;
export const STATION_CAPACITY_STEP = 500;

export const STATION_COST_MODEL = Object.freeze({
  fixed: 55_000,
  linear: 55,
  quadratic: 0.015,
  minimumRegionalMultiplier: 0.85,
  maximumRegionalMultiplier: 1.20,
});

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

export const getRegionalCostMultiplier = (
  candidate,
  costModel = STATION_COST_MODEL,
) => clamp(
  Number.isFinite(candidate?.housingCostIndex) && candidate.housingCostIndex > 0
    ? candidate.housingCostIndex
    : 1,
  costModel.minimumRegionalMultiplier,
  costModel.maximumRegionalMultiplier,
);

export const getStationCost = (
  candidate,
  capacity,
  costModel = STATION_COST_MODEL,
) => {
  const normalizedCapacity = Math.max(0, Number(capacity) || 0);
  const baseCost = costModel.fixed
    + costModel.linear * normalizedCapacity
    + costModel.quadratic * normalizedCapacity ** 2;
  return Math.round(
    (baseCost * getRegionalCostMultiplier(candidate, costModel)) / 1000,
  ) * 1000;
};
