# Heat Relief Planner

Long-pressing **New game** traverses every buildable cell and all five shelter
radii on the current map. It builds a full-map greedy/local-search plan, then
runs capacity-aware branch-and-bound refinement over the strongest locations
discovered during traversal. The objective is lexicographic: maximize
population served, then minimize cost.

An interactive pixel-grid planning tool for exploring heat-relief station placement in Queenstown, Singapore.

The base grid uses the URA Master Plan 2019 planning-area boundary and OpenStreetMap features. Population is allocated from official Census 2020 MP2019-subzone totals, and housing cost is interpolated from recent official HDB resale transactions. Heat exposure remains a modelling proxy.

## Features

- 370 x 353 GIS-derived grid with 20 m cells and subzone views
- Base-map and mutually exclusive single-layer views
- Zoom, pan, and responsive mobile layout
- Budget-based station placement scored by population served
- 383 mapped existing cooling facilities, including convenience stores, supermarkets, cafes, libraries, community facilities, and malls
- Capacity-constrained service allocation from the centre cell through successive Manhattan-distance rings
- Residual population demand that cannot be served twice by overlapping shelters
- Cell-specific construction costs based on the local HDB resale-price index
- Greedy construction with local-search improvements for optimized strategies
- Replayable greedy-decision animation with compact parameters, data-labelled close-ups, and map-overview intervals
- Automatic map demo recording with a four-stage data-layer tour, synchronized decision parameters, optional intro-free export, and shelter-selection audio cues
- Existing shelters reduce population demand before player construction begins
- Candidate ranking by expected people served per construction dollar

## Run locally

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

Refresh the socioeconomic grid fields with:

```bash
npm run generate:socioeconomic
```

Refresh existing shelter amenities with:

```bash
npm run generate:facilities
```

The generated cell fields are `population`, `seniorPopulation`,
`housingPricePsm`, and `housingCostIndex`. Population is conserved within each
subzone. HDB prices are a local cost-pressure proxy, not a land valuation.

## Data attribution

- Planning boundary: Singapore Urban Redevelopment Authority, Master Plan 2019 Planning Area Boundary (No Sea)
- Map features: OpenStreetMap contributors, available under the Open Database License
- Population: Singapore Department of Statistics, Census of Population 2020, MP2019 subzones
- Housing: Housing & Development Board resale transactions, geocoded with Singapore Land Authority OneMap

Amenity capacities are modelling assumptions by facility type and are not
official occupancy limits.
