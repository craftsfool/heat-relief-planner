import {
  Building2,
  Check,
  Download,
  LoaderCircle,
  MapPin,
  Maximize2,
  TrainFront,
  Trees,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRef, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { toPng } from "html-to-image";
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
  if (cell.outside) return null;
  const visibleLayers = mode === "base"
    ? []
    : mode === "single"
      ? layers.filter((layer) => layer.id === activeLayer)
      : layers;
  const stationCoverage = getStationCoverage(cell, placed);
  const maxCompositeWeight = Math.max(
    0,
    ...visibleLayers
      .filter((layer) => enabled[layer.id])
      .map((layer) => weights[layer.id]),
  );
  const remainingDemand = 1 - stationCoverage * 0.84;

  return (
    <span className="cell-overlays" aria-hidden="true">
      {visibleLayers.map((layer) => {
        if (!enabled[layer.id]) return null;
        const intensity = cell[layer.id];
        const opacity = mode === "single"
          ? Math.min(0.72, 0.08 + intensity * 0.64)
          : maxCompositeWeight > 0 && weights[layer.id] > 0
            ? Math.min(
                0.34,
                (0.04 + intensity * 0.26) *
                  (0.55 + 0.45 * (weights[layer.id] / maxCompositeWeight)),
              )
            : 0;
        return (
          <span
            className="layer-fill"
            key={layer.id}
            style={{ backgroundColor: layer.color, opacity: opacity * remainingDemand }}
          />
        );
      })}
      {stationCoverage > 0 && (
        <span
          className="service-reduction"
          style={{ opacity: stationCoverage * 0.72 }}
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
  const mapShellRef = useRef(null);
  const [exportStatus, setExportStatus] = useState("idle");
  const candidateIndex = new Map(candidates.map((candidate, index) => [candidate.id, index + 1]));
  const placedIds = new Set(placed.map((station) => station.id));

  const exportVisibleMap = async () => {
    if (!mapShellRef.current || exportStatus === "exporting") return;

    setExportStatus("exporting");
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const node = mapShellRef.current;
      const { width, height } = node.getBoundingClientRect();
      const dataUrl = await toPng(node, {
        backgroundColor: "#dfe8ef",
        cacheBust: true,
        width: Math.round(width),
        height: Math.round(height),
        pixelRatio: Math.max(1, window.devicePixelRatio || 1),
        filter: (element) => element.dataset?.exportIgnore !== "true",
        style: { cursor: "default" },
      });
      const link = document.createElement("a");
      link.download = `queenstown-heat-relief-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
      setExportStatus("done");
    } catch (error) {
      console.error("Unable to export the visible map", error);
      setExportStatus("error");
    } finally {
      window.setTimeout(() => setExportStatus("idle"), 1800);
    }
  };

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

        <div className="map-toolbar-meta">
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
          <button
            className={`map-export-button is-${exportStatus}`}
            data-testid="map-export-button"
            type="button"
            title="Export current visible map as a native-resolution PNG"
            aria-label="Export current visible map as PNG"
            disabled={exportStatus === "exporting"}
            onClick={exportVisibleMap}
          >
            {exportStatus === "exporting" ? (
              <LoaderCircle className="is-spinning" size={15} />
            ) : exportStatus === "done" ? (
              <Check size={15} />
            ) : (
              <Download size={15} />
            )}
            <span>{exportStatus === "exporting" ? "Exporting" : exportStatus === "done" ? "Saved" : exportStatus === "error" ? "Retry export" : "Export PNG"}</span>
          </button>
        </div>
      </div>

      <div className="map-shell" ref={mapShellRef}>
        <TransformWrapper
          initialScale={0.78}
          minScale={0.42}
          maxScale={5}
          centerOnInit
          limitToBounds={false}
          smooth={false}
          wheel={{ step: 0.1, activationKeys: ["Control"] }}
          panning={{ velocityDisabled: true }}
          doubleClick={{ mode: "zoomIn", step: 0.5, animationTime: 0 }}
          zoomAnimation={{ disabled: true }}
          autoAlignment={{ disabled: true }}
          velocityAnimation={{ disabled: true }}
        >
          {({ zoomIn, zoomOut, centerView }) => (
            <>
              <div className="map-zoom-controls" aria-label="Map zoom controls" data-export-ignore="true">
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
          <div className="hover-readout" data-export-ignore="true">
            <span>{hovered.lat.toFixed(4)}, {hovered.lon.toFixed(4)}</span>
            <strong>{hovered.zone}</strong>
          </div>
        )}
      </div>
    </main>
  );
}
