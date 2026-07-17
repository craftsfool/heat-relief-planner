# Heat Relief Planner

An interactive pixel-grid planning tool for exploring heat-relief station placement in Queenstown, Singapore.

The base grid uses the URA Master Plan 2019 planning-area boundary and OpenStreetMap features. Heat exposure, vulnerable population, pedestrian flow, and cooling-facility values are modelling proxies for project exploration rather than official measurements.

## Features

- 370 x 353 GIS-derived grid with 20 m cells and subzone views
- Composite and single-factor map views
- Zoom, pan, and responsive mobile layout
- Budget-based station placement scored by priority reduction on accessible land
- Greedy construction with local-search improvements for optimized strategies
- Replayable greedy-decision animation with score-labelled close-ups, before/after score changes, and map-overview intervals
- Draggable, resizable, and hideable map tool windows
- Marginal shelter effects that do not stack below a cell score of zero
- Candidate ranking and site-level score breakdowns

## Run locally

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

## Data attribution

- Planning boundary: Singapore Urban Redevelopment Authority, Master Plan 2019 Planning Area Boundary (No Sea)
- Map features: OpenStreetMap contributors, available under the Open Database License
