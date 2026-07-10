# Heat Relief Planner

An interactive pixel-grid planning tool for exploring heat-relief station placement in Queenstown, Singapore.

The base grid uses the URA Master Plan 2019 planning-area boundary and OpenStreetMap features. Heat exposure, vulnerable population, pedestrian flow, and cooling-facility values are modelling proxies for project exploration rather than official measurements.

## Features

- 46 x 44 GIS-derived grid with approximately 160 m cells
- Composite and single-factor map views
- Zoom, pan, and responsive mobile layout
- Budget-based station placement with dynamic coverage reduction
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

