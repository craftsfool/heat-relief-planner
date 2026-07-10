import {
  Building2,
  MapPin,
  Maximize2,
  TrainFront,
  Trees,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import {
  getStationCoverage,
  GRID_COLS,
  GRID_ROWS,
  MAP_LABELS,
  MAP_METADATA,
} from "../model/cityModel";

const facilityIcon = {
  mall: Building2,
  community: Trees,
};

function CellOverlay({ cell, layers, weights, enabled, mode, activeLayer, placed }) {
  if (mode === "base" || cell.outside) return null;
  const visibleLayers = mode === "single" ? layers.filter((layer) => layer.id === activeLayer) : layers;
  const stationCoverage = getStationCoverage(cell, placed);

  return (
    <span className="cell-overlays" aria-hidden="true">
      {visibleLayers.map((layer) => {
        if (!enabled[layer.id]) return null;
        const intensity = cell[layer.id];
        const opacity = mode === "single"
          ? Math.min(0.72, 0.06 + intensity * 0.64)
          : Math.min(0.28, intensity * weights[layer.id] * 0.72);
        return (
          <span
            className="layer-fill"
            key={layer.id}
            style={{ backgroundColor: layer.color, opacity }}
          />
        );
      })}
      {stationCoverage > 0 && (
        <span
          className="service-reduction"
          style={{ opacity: stationCoverage * 0.38 }}
        />
      )}
    </span>
  );
}

export function MapCanvas({
  cells,
  layers,
  weights,
  enabled,
  mode,
  activeLayer,
  candidates,
  selected,
  hovered,
  placed,
  onMode,
  onSelect,
  onHover,
}) {
  const candidateIndex = new Map(candidates.map((candidate, index) => [candidate.id, index + 1]));
  const placedIds = new Set(placed.map((station) => station.id));

  return (
    <main className="map-workspace">
      <div className="map-toolbar">
        <div className="segmented-control" aria-label="Map view mode">
          <button className={mode === "composite" ? "is-selected" : ""} onClick={() => onMode("composite")} type="button">
            Composite
          </button>
          <button className={mode === "single" ? "is-selected" : ""} onClick={() => onMode("single")} type="button">
            Single layer
          </button>
          <button className={mode === "base" ? "is-selected" : ""} onClick={() => onMode("base")} type="button">
            Base map
          </button>
        </div>

        <div className="map-legend" aria-label="Score intensity legend">
          <span>{mode === "single" ? layers.find((layer) => layer.id === activeLayer)?.label : "Layer intensity"}</span>
          <div className="legend-steps">
            {[0.16, 0.3, 0.44, 0.58, 0.72].map((opacity) => (
              <i key={opacity} style={{ opacity }} />
            ))}
          </div>
          <small>Low</small>
          <small>High</small>
        </div>
      </div>

      <div className="map-shell">
        <TransformWrapper
          initialScale={0.78}
          minScale={0.42}
          maxScale={5}
          centerOnInit
          limitToBounds={false}
          wheel={{ step: 0.16 }}
          panning={{ velocityDisabled: true }}
          doubleClick={{ mode: "zoomIn", step: 0.7 }}
        >
          {({ zoomIn, zoomOut, centerView }) => (
            <>
              <div className="map-zoom-controls" aria-label="Map zoom controls">
                <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomIn(0.35, 0)}>
                  <ZoomIn size={17} />
                </button>
                <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomOut(0.35, 0)}>
                  <ZoomOut size={17} />
                </button>
                <button type="button" title="Reset map view" aria-label="Reset map view" onClick={() => centerView(0.78, 0)}>
                  <Maximize2 size={16} />
                </button>
              </div>

              <div className="map-place-title">
                <strong>Queenstown</strong>
                <span>{MAP_METADATA.cellSizeMetres} m GIS grid</span>
              </div>

              <TransformComponent
                wrapperClass="map-transform-wrapper"
                contentClass="map-transform-content"
              >
                <div
                  className="pixel-map real-pixel-map"
                  style={{
                    gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
                  }}
                  onMouseLeave={() => onHover(null)}
                >
                  {cells.map((cell) => {
                    const FacilityIcon = cell.facility ? facilityIcon[cell.facility.kind] : null;
                    const isSelected = selected?.id === cell.id;
                    const isHovered = hovered?.id === cell.id;
                    return (
                      <button
                        type="button"
                        className={[
                          "map-cell",
                          cell.outside ? "is-outside" : "",
                          cell.water ? "is-water" : "",
                          cell.park ? "is-park" : "",
                          cell.road === "major" ? "is-road is-road-major" : "",
                          cell.road === "minor" ? "is-road is-road-minor" : "",
                          isSelected ? "is-selected" : "",
                          isHovered ? "is-hovered" : "",
                        ].join(" ")}
                        key={cell.id}
                        aria-label={`Cell ${cell.x + 1}, ${cell.y + 1}, ${cell.zone}`}
                        tabIndex={cell.outside ? -1 : 0}
                        onMouseEnter={() => !cell.outside && onHover(cell)}
                        onFocus={() => !cell.outside && onHover(cell)}
                        onClick={() => !cell.outside && !cell.water && onSelect(cell)}
                      >
                        <CellOverlay
                          cell={cell}
                          layers={layers}
                          weights={weights}
                          enabled={enabled}
                          mode={mode}
                          activeLayer={activeLayer}
                          placed={placed}
                        />
                        {cell.transit && <TrainFront className="map-symbol transit-symbol" size={13} aria-label={cell.transit.label} />}
                        {FacilityIcon && <FacilityIcon className="map-symbol facility-symbol" size={11} aria-label={cell.facility.label} />}
                        {candidateIndex.has(cell.id) && !placedIds.has(cell.id) && (
                          <span className="candidate-marker">{candidateIndex.get(cell.id)}</span>
                        )}
                        {placedIds.has(cell.id) && (
                          <span className="station-marker" title="Placed heat-relief station">
                            <MapPin size={12} fill="currentColor" />
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {MAP_LABELS.map((label) => (
                    <span
                      className="real-place-label"
                      key={label.label}
                      style={{
                        left: `${((label.x + 0.5) / GRID_COLS) * 100}%`,
                        top: `${((label.y + 0.5) / GRID_ROWS) * 100}%`,
                      }}
                    >
                      {label.label}
                    </span>
                  ))}
                </div>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>

        <div className="map-attribution">
          <a href={MAP_METADATA.boundarySource.url} target="_blank" rel="noreferrer">URA boundary</a>
          <span>·</span>
          <a href={MAP_METADATA.featureSource.url} target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        </div>

        {hovered && !hovered.water && !hovered.outside && (
          <div className="hover-readout">
            <span>{hovered.lat.toFixed(4)}, {hovered.lon.toFixed(4)}</span>
            <strong>{hovered.zone}</strong>
          </div>
        )}
      </div>
    </main>
  );
}
