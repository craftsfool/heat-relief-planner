import {
  ArrowLeft,
  Check,
  Download,
  LoaderCircle,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { toPng } from "html-to-image";
import { ShelterRoster } from "./ShelterRoster";
import {
  getStationCoverage,
  GRID_COLS,
  GRID_ROWS,
  MAP_METADATA,
  MAP_SUBZONES,
  scoreCell,
} from "../model/cityModel";

const BASE_COLORS = {
  land: [226, 229, 232],
  roadMinor: [233, 236, 239],
  roadMajor: [250, 249, 244],
  park: [188, 213, 164],
  water: [117, 185, 220],
  building: [180, 176, 169],
  construction: [205, 143, 108],
  facility: [65, 86, 108],
  transit: [91, 72, 143],
};

const hexToRgb = (hex) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const blend = (base, overlay, opacity) => base.map(
  (channel, index) => Math.round(channel * (1 - opacity) + overlay[index] * opacity),
);

const getBaseColor = (cell) => {
  if (cell.water) return BASE_COLORS.water;
  if (cell.transit) return BASE_COLORS.transit;
  if (cell.facility) return BASE_COLORS.facility;
  if (cell.construction) return BASE_COLORS.construction;
  if (cell.building) return BASE_COLORS.building;
  if (cell.park) return BASE_COLORS.park;
  if (cell.road === "major") return BASE_COLORS.roadMajor;
  if (cell.road === "minor") return BASE_COLORS.roadMinor;
  return BASE_COLORS.land;
};

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
  activeSubzoneCode,
  onSubzone,
  onMode,
  onSelect,
  onHover,
}) {
  const mapShellRef = useRef(null);
  const mapSurfaceRef = useRef(null);
  const canvasRef = useRef(null);
  const [exportStatus, setExportStatus] = useState("idle");
  const activeSubzone = MAP_SUBZONES.find((subzone) => subzone.code === activeSubzoneCode) ?? null;
  const initialMapScale = activeSubzone ? 1.35 : 0.82;
  const [mapTransform, setMapTransform] = useState({
    scale: initialMapScale,
    positionX: 0,
    positionY: 0,
  });
  const [mapSurfaceSize, setMapSurfaceSize] = useState({ width: 0, height: 0 });
  const mapScale = mapTransform.scale;
  const viewBounds = activeSubzone?.bounds ?? {
    minX: 0,
    minY: 0,
    maxX: GRID_COLS - 1,
    maxY: GRID_ROWS - 1,
  };
  const viewColumns = viewBounds.maxX - viewBounds.minX + 1;
  const viewRows = viewBounds.maxY - viewBounds.minY + 1;
  const viewCells = useMemo(
    () => activeSubzone
      ? cells.filter((cell) => cell.subzoneCode === activeSubzone.code)
      : cells,
    [activeSubzone, cells],
  );
  const viewCellByCoordinate = useMemo(
    () => new Map(viewCells.map((cell) => [`${cell.x}-${cell.y}`, cell])),
    [viewCells],
  );
  const visibleCandidates = useMemo(
    () => activeSubzone
      ? candidates.filter((candidate) => candidate.subzoneCode === activeSubzone.code)
      : candidates,
    [activeSubzone, candidates],
  );
  const candidateIndex = useMemo(
    () => new Map(candidates.map((candidate, index) => [candidate.id, index + 1])),
    [candidates],
  );
  const placedIds = useMemo(() => new Set(placed.map((station) => station.id)), [placed]);
  const hoveredInView = hovered && (!activeSubzone || hovered.subzoneCode === activeSubzone.code)
    ? hovered
    : null;
  const hoveredScore = hoveredInView
    ? scoreCell(hoveredInView, weights, enabled, placed)
    : 0;
  const scaledMapWidth = mapSurfaceSize.width * mapScale;
  const scaledMapHeight = mapSurfaceSize.height * mapScale;
  const screenCellSize = scaledMapWidth / viewColumns;
  const beaconScreenSize = Math.min(72, Math.max(16, screenCellSize * 0.65));
  const beaconFontSize = Math.min(42, Math.max(9, screenCellSize * 0.38));
  const beaconRadius = Math.min(14, Math.max(4, screenCellSize * 0.12));
  const beaconGlow = Math.min(8, Math.max(3, screenCellSize * 0.08));

  const overlayPoint = (x, y, centered = true) => ({
    left: mapTransform.positionX +
      ((x - viewBounds.minX + (centered ? 0.5 : 0)) / viewColumns) * scaledMapWidth,
    top: mapTransform.positionY +
      ((y - viewBounds.minY + (centered ? 0.5 : 0)) / viewRows) * scaledMapHeight,
  });

  useEffect(() => {
    setMapTransform({ scale: initialMapScale, positionX: 0, positionY: 0 });
  }, [activeSubzoneCode, initialMapScale]);

  useEffect(() => {
    const surface = mapSurfaceRef.current;
    if (!surface) return undefined;
    const updateSize = () => {
      const next = { width: surface.offsetWidth, height: surface.offsetHeight };
      setMapSurfaceSize((current) => current.width === next.width && current.height === next.height
        ? current
        : next);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [activeSubzoneCode, viewColumns, viewRows]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = viewColumns;
    canvas.height = viewRows;
    const context = canvas.getContext("2d", { alpha: true });
    const image = context.createImageData(viewColumns, viewRows);
    const visibleLayers = mode === "base"
      ? []
      : mode === "single"
        ? layers.filter((layer) => layer.id === activeLayer)
        : layers;
    const maxCompositeWeight = Math.max(
      0,
      ...visibleLayers
        .filter((layer) => enabled[layer.id])
        .map((layer) => weights[layer.id]),
    );

    for (const cell of viewCells) {
      let color = getBaseColor(cell);
      const stationCoverage = getStationCoverage(cell, placed);

      for (const layer of visibleLayers) {
        if (!enabled[layer.id]) continue;
        const intensity = cell[layer.id];
        const opacity = mode === "single"
          ? Math.min(0.74, 0.08 + intensity * 0.66)
          : maxCompositeWeight > 0 && weights[layer.id] > 0
            ? Math.min(
                0.36,
                (0.04 + intensity * 0.28) *
                  (0.55 + 0.45 * (weights[layer.id] / maxCompositeWeight)),
              )
            : 0;
        color = blend(color, hexToRgb(layer.color), opacity * (1 - stationCoverage * 0.84));
      }

      if (stationCoverage > 0) {
        color = blend(color, [244, 255, 249], stationCoverage * 0.72);
      }

      const localX = cell.x - viewBounds.minX;
      const localY = cell.y - viewBounds.minY;
      const index = (localY * viewColumns + localX) * 4;
      image.data[index] = color[0];
      image.data[index + 1] = color[1];
      image.data[index + 2] = color[2];
      image.data[index + 3] = 255;
    }

    context.putImageData(image, 0, 0);
  }, [activeLayer, enabled, layers, mode, placed, viewBounds.minX, viewBounds.minY, viewCells, viewColumns, viewRows, weights]);

  const cellFromPointer = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = Math.floor(((event.clientX - bounds.left) / bounds.width) * viewColumns);
    const localY = Math.floor(((event.clientY - bounds.top) / bounds.height) * viewRows);
    return viewCellByCoordinate.get(`${localX + viewBounds.minX}-${localY + viewBounds.minY}`) ?? null;
  };

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
      const mapName = activeSubzone?.name.toLowerCase().replaceAll(" ", "-") ?? "queenstown";
      link.download = `${mapName}-heat-relief-${new Date().toISOString().slice(0, 10)}.png`;
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
          <button className={mode === "composite" ? "is-selected" : ""} onClick={() => onMode("composite")} type="button">Composite</button>
          <button className={mode === "single" ? "is-selected" : ""} onClick={() => onMode("single")} type="button">Single layer</button>
          <button className={mode === "base" ? "is-selected" : ""} onClick={() => onMode("base")} type="button">Base map</button>
        </div>

        <div className="map-toolbar-meta">
          <div className="map-legend" aria-label="Score intensity legend">
            <span>{mode === "single" ? layers.find((layer) => layer.id === activeLayer)?.label : "Layer intensity"}</span>
            <div className="legend-steps">
              {[0.16, 0.3, 0.44, 0.58, 0.72].map((opacity) => <i key={opacity} style={{ opacity }} />)}
            </div>
            <small>Low</small><small>High</small>
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
            {exportStatus === "exporting" ? <LoaderCircle className="is-spinning" size={15} /> : exportStatus === "done" ? <Check size={15} /> : <Download size={15} />}
            <span>{exportStatus === "exporting" ? "Exporting" : exportStatus === "done" ? "Saved" : exportStatus === "error" ? "Retry export" : "Export PNG"}</span>
          </button>
        </div>
      </div>

      <div className="map-shell" ref={mapShellRef}>
        <TransformWrapper
          key={activeSubzoneCode ?? "queenstown"}
          initialScale={initialMapScale}
          minScale={0.42}
          maxScale={48}
          centerOnInit
          limitToBounds={false}
          smooth={false}
          wheel={{ step: 0.22, activationKeys: ["Control"] }}
          panning={{ velocityDisabled: true }}
          doubleClick={{ mode: "zoomIn", step: 2.5, animationTime: 0 }}
          zoomAnimation={{ disabled: true }}
          autoAlignment={{ disabled: true }}
          velocityAnimation={{ disabled: true }}
          onTransform={(_, state) => setMapTransform({
            scale: state.scale,
            positionX: state.positionX,
            positionY: state.positionY,
          })}
        >
          {({ zoomIn, zoomOut, centerView }) => (
            <>
              <div className="map-zoom-controls" aria-label="Map zoom controls" data-export-ignore="true">
                <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomIn(2, 0)}><ZoomIn size={17} /></button>
                <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomOut(2, 0)}><ZoomOut size={17} /></button>
                <button type="button" title="Reset map view" aria-label="Reset map view" onClick={() => centerView(initialMapScale, 0)}><Maximize2 size={16} /></button>
              </div>

              <div className="map-place-title">
                {activeSubzone && (
                  <button className="subzone-back-button" type="button" onClick={() => onSubzone(null)}>
                    <ArrowLeft size={14} /> Queenstown
                  </button>
                )}
                <strong>{activeSubzone?.name ?? "Queenstown"}</strong>
                <span>{MAP_METADATA.cellSizeMetres} m grid · {viewCells.length.toLocaleString()} visible cells · {visibleCandidates.length} candidate sites</span>
              </div>

              <TransformComponent wrapperClass="map-transform-wrapper" contentClass="map-transform-content">
                <div
                  ref={mapSurfaceRef}
                  className={`canvas-map ${mapScale >= 3.5 ? "is-cell-detail" : ""}`}
                  style={{
                    aspectRatio: `${viewColumns} / ${viewRows}`,
                  }}
                  onMouseMove={(event) => onHover(cellFromPointer(event))}
                  onMouseLeave={() => onHover(null)}
                  onClick={(event) => {
                    const cell = cellFromPointer(event);
                    if (cell && candidateIndex.has(cell.id)) onSelect(cell);
                  }}
                >
                  <canvas ref={canvasRef} aria-label={`${activeSubzone?.name ?? "Queenstown"} 20 metre planning grid`} />
                </div>
              </TransformComponent>

              {mapSurfaceSize.width > 0 && (
                <div
                  className="map-interaction-overlay"
                  style={{
                    "--screen-cell-size": `${screenCellSize}px`,
                    "--screen-beacon-size": `${beaconScreenSize}px`,
                    "--screen-beacon-font": `${beaconFontSize}px`,
                    "--screen-beacon-radius": `${beaconRadius}px`,
                    "--screen-beacon-glow": `${beaconGlow}px`,
                  }}
                >
                  {hoveredInView && (
                    <span
                      className="map-cell-highlight"
                      data-testid="map-cell-highlight"
                      style={overlayPoint(hoveredInView.x, hoveredInView.y, false)}
                    />
                  )}

                  {!activeSubzone && MAP_SUBZONES.map((subzone) => (
                    <button
                      className="subzone-map-label"
                      key={subzone.code}
                      type="button"
                      style={overlayPoint(subzone.x, subzone.y)}
                      title={`Open ${subzone.name} subzone`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSubzone(subzone.code);
                      }}
                    >
                      {subzone.name}
                    </button>
                  ))}

                  {visibleCandidates.map((candidate) => {
                    const rank = candidateIndex.get(candidate.id);
                    const isStation = placedIds.has(candidate.id);
                    return (
                      <button
                        className={`map-site-marker ${isStation ? "is-station" : ""} ${selected?.id === candidate.id ? "is-selected" : ""}`}
                        key={candidate.id}
                        type="button"
                        style={overlayPoint(candidate.x, candidate.y)}
                        aria-label={`Candidate ${rank}, ${candidate.zone}`}
                        title={`Candidate ${rank} · ${candidate.zone}`}
                        onMouseEnter={() => onHover(candidate)}
                        onFocus={() => onHover(candidate)}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(candidate);
                        }}
                      >
                        <span>{rank}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </TransformWrapper>

        <ShelterRoster placed={placed} candidates={candidates} cells={cells} selected={selected} onSelect={onSelect} />

        <div className="map-attribution">
          <a href={MAP_METADATA.boundarySource.url} target="_blank" rel="noreferrer">URA subzones</a>
          <span>·</span>
          <a href={MAP_METADATA.featureSource.url} target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        </div>

        {hoveredInView && (
          <div className="hover-readout" data-export-ignore="true" data-testid="cell-score-readout">
            <div className={`hover-score ${hoveredScore < 0 ? "is-negative" : ""}`}>
              <span>Composite score</span>
              <strong>{hoveredScore}</strong>
            </div>
            <strong>{hoveredInView.zone}</strong>
            <span>Cell {hoveredInView.x + 1}, {hoveredInView.y + 1} · {hoveredInView.buildable ? "Buildable" : "Unavailable"}</span>
            <small>
              H {Math.round(hoveredInView.heat * 100)} · V {Math.round(hoveredInView.vulnerable * 100)} · F {Math.round(hoveredInView.flow * 100)} · C {Math.round(hoveredInView.cooling * 100)}
            </small>
          </div>
        )}
      </div>
    </main>
  );
}
