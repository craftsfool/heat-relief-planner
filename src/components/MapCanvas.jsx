import {
  ArrowLeft,
  Check,
  Download,
  LoaderCircle,
  MapPinned,
  Maximize2,
  Play,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { toPng } from "html-to-image";
import { GreedyDemoPanel } from "./GreedyDemoPanel";
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

const SCORE_LABEL_MIN_CELL_PX = 28;
const DEMO_TARGET_CELL_PX = 56;
const MAX_MAP_SCALE = 48;

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
  greedyDemo,
  onSubzone,
  onMode,
  onSelect,
  onHover,
  onStartGreedyDemo,
  onToggleGreedyDemo,
  onStepGreedyDemo,
  onRestartGreedyDemo,
  onCloseGreedyDemo,
  onGreedyDemoSpeed,
}) {
  const mapShellRef = useRef(null);
  const mapSurfaceRef = useRef(null);
  const mapOverlayRef = useRef(null);
  const canvasRef = useRef(null);
  const transformControlsRef = useRef(null);
  const scoreViewportKeyRef = useRef("");
  const previousDemoOpenRef = useRef(false);
  const [exportStatus, setExportStatus] = useState("idle");
  const [isRosterVisible, setIsRosterVisible] = useState(true);
  const [hoveredSubzoneCode, setHoveredSubzoneCode] = useState(null);
  const [scoreCells, setScoreCells] = useState([]);
  const activeSubzone = MAP_SUBZONES.find((subzone) => subzone.code === activeSubzoneCode) ?? null;
  const initialMapScale = activeSubzone ? 1.35 : 0.82;
  const mapTransformRef = useRef({
    scale: initialMapScale,
    positionX: 0,
    positionY: 0,
  });
  const mapSurfaceSizeRef = useRef({ width: 0, height: 0 });
  const [mapSurfaceSize, setMapSurfaceSize] = useState({ width: 0, height: 0 });
  const cellDetailRef = useRef(initialMapScale >= 3.5);
  const [isCellDetail, setIsCellDetail] = useState(cellDetailRef.current);
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
  const currentGreedyStep = greedyDemo.steps[greedyDemo.stepIndex] ?? null;
  const hoveredInView = hovered && (!activeSubzone || hovered.subzoneCode === activeSubzone.code)
    ? hovered
    : null;
  const hoveredScore = hoveredInView
    ? scoreCell(hoveredInView, weights, enabled, placed)
    : 0;
  const hoveredSubzoneBoundaryPath = useMemo(() => {
    if (activeSubzone || !hoveredSubzoneCode) return "";

    const segments = [];
    const isSameSubzone = (x, y) =>
      viewCellByCoordinate.get(`${x}-${y}`)?.subzoneCode === hoveredSubzoneCode;

    for (const cell of viewCells) {
      if (cell.subzoneCode !== hoveredSubzoneCode) continue;
      const x = cell.x - viewBounds.minX;
      const y = cell.y - viewBounds.minY;
      if (!isSameSubzone(cell.x, cell.y - 1)) segments.push(`M${x} ${y}H${x + 1}`);
      if (!isSameSubzone(cell.x + 1, cell.y)) segments.push(`M${x + 1} ${y}V${y + 1}`);
      if (!isSameSubzone(cell.x, cell.y + 1)) segments.push(`M${x + 1} ${y + 1}H${x}`);
      if (!isSameSubzone(cell.x - 1, cell.y)) segments.push(`M${x} ${y + 1}V${y}`);
    }
    return segments.join(" ");
  }, [activeSubzone, hoveredSubzoneCode, viewBounds.minX, viewBounds.minY, viewCellByCoordinate, viewCells]);

  const syncMapOverlay = (
    transform = mapTransformRef.current,
    surfaceSize = mapSurfaceSizeRef.current,
  ) => {
    const overlay = mapOverlayRef.current;
    if (!overlay || !surfaceSize.width || !surfaceSize.height) return;

    const scaledMapWidth = surfaceSize.width * transform.scale;
    const scaledMapHeight = surfaceSize.height * transform.scale;
    const screenCellSize = scaledMapWidth / viewColumns;
    const devicePixelRatio = window.devicePixelRatio || 1;
    const snap = (value) => Math.round(value * devicePixelRatio) / devicePixelRatio;
    const cellRect = (x, y) => {
      const localX = x - viewBounds.minX;
      const localY = y - viewBounds.minY;
      const left = snap(transform.positionX + (localX / viewColumns) * scaledMapWidth);
      const right = snap(transform.positionX + ((localX + 1) / viewColumns) * scaledMapWidth);
      const top = snap(transform.positionY + (localY / viewRows) * scaledMapHeight);
      const bottom = snap(transform.positionY + ((localY + 1) / viewRows) * scaledMapHeight);
      return { left, top, width: right - left, height: bottom - top };
    };

    overlay.style.setProperty("--screen-cell-size", `${screenCellSize}px`);
    overlay.style.setProperty(
      "--screen-score-font",
      `${Math.min(34, Math.max(9, screenCellSize * 0.34))}px`,
    );
    overlay.style.setProperty(
      "--screen-beacon-size",
      `${Math.min(72, Math.max(16, screenCellSize * 0.65))}px`,
    );
    overlay.style.setProperty(
      "--screen-beacon-font",
      `${Math.min(42, Math.max(9, screenCellSize * 0.38))}px`,
    );
    overlay.style.setProperty(
      "--screen-beacon-radius",
      `${Math.min(14, Math.max(4, screenCellSize * 0.12))}px`,
    );
    overlay.style.setProperty(
      "--screen-beacon-glow",
      `${Math.min(8, Math.max(3, screenCellSize * 0.08))}px`,
    );

    overlay.querySelectorAll("[data-map-boundary]").forEach((element) => {
      element.style.left = `${snap(transform.positionX)}px`;
      element.style.top = `${snap(transform.positionY)}px`;
      element.style.width = `${snap(scaledMapWidth)}px`;
      element.style.height = `${snap(scaledMapHeight)}px`;
    });

    overlay.querySelectorAll("[data-map-x][data-map-y]").forEach((element) => {
      const rect = cellRect(Number(element.dataset.mapX), Number(element.dataset.mapY));
      if (element.dataset.mapCell === "true") {
        element.style.left = `${rect.left}px`;
        element.style.top = `${rect.top}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
      } else {
        element.style.left = `${rect.left + rect.width / 2}px`;
        element.style.top = `${rect.top + rect.height / 2}px`;
      }
    });
  };

  const syncScoreViewport = (
    transform = mapTransformRef.current,
    surfaceSize = mapSurfaceSizeRef.current,
  ) => {
    const shell = mapShellRef.current;
    if (!shell || !surfaceSize.width || !surfaceSize.height) return;

    const scaledMapWidth = surfaceSize.width * transform.scale;
    const scaledMapHeight = surfaceSize.height * transform.scale;
    const screenCellWidth = scaledMapWidth / viewColumns;
    const screenCellHeight = scaledMapHeight / viewRows;
    if (Math.min(screenCellWidth, screenCellHeight) < SCORE_LABEL_MIN_CELL_PX) {
      if (scoreViewportKeyRef.current) {
        scoreViewportKeyRef.current = "";
        setScoreCells([]);
      }
      return;
    }

    const shellWidth = shell.clientWidth;
    const shellHeight = shell.clientHeight;
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const minLocalX = clamp(Math.floor((-transform.positionX) / screenCellWidth) - 1, 0, viewColumns - 1);
    const maxLocalX = clamp(Math.ceil((shellWidth - transform.positionX) / screenCellWidth) + 1, 0, viewColumns - 1);
    const minLocalY = clamp(Math.floor((-transform.positionY) / screenCellHeight) - 1, 0, viewRows - 1);
    const maxLocalY = clamp(Math.ceil((shellHeight - transform.positionY) / screenCellHeight) + 1, 0, viewRows - 1);
    const nextKey = `${activeSubzoneCode ?? "queenstown"}:${minLocalX}:${maxLocalX}:${minLocalY}:${maxLocalY}`;
    if (nextKey === scoreViewportKeyRef.current) return;

    const nextCells = [];
    for (let localY = minLocalY; localY <= maxLocalY; localY += 1) {
      for (let localX = minLocalX; localX <= maxLocalX; localX += 1) {
        const cell = viewCellByCoordinate.get(`${localX + viewBounds.minX}-${localY + viewBounds.minY}`);
        if (cell) nextCells.push(cell);
      }
    }
    scoreViewportKeyRef.current = nextKey;
    setScoreCells(nextCells);
  };

  useEffect(() => {
    const initialTransform = { scale: initialMapScale, positionX: 0, positionY: 0 };
    mapTransformRef.current = initialTransform;
    cellDetailRef.current = initialMapScale >= 3.5;
    setIsCellDetail(cellDetailRef.current);
    scoreViewportKeyRef.current = "";
    setScoreCells([]);
  }, [activeSubzoneCode, initialMapScale]);

  useEffect(() => {
    const surface = mapSurfaceRef.current;
    if (!surface) return undefined;
    const updateSize = (contentRect) => {
      const next = contentRect
        ? { width: contentRect.width, height: contentRect.height }
        : (() => {
            const bounds = surface.getBoundingClientRect();
            const scale = mapTransformRef.current.scale || 1;
            return { width: bounds.width / scale, height: bounds.height / scale };
          })();
      mapSurfaceSizeRef.current = next;
      setMapSurfaceSize((current) => current.width === next.width && current.height === next.height
        ? current
        : next);
      syncMapOverlay(mapTransformRef.current, next);
      syncScoreViewport(mapTransformRef.current, next);
    };
    updateSize();
    const observer = new ResizeObserver(([entry]) => updateSize(entry.contentRect));
    observer.observe(surface);
    return () => observer.disconnect();
  }, [activeSubzoneCode, viewColumns, viewRows]);

  useLayoutEffect(() => {
    syncMapOverlay();
  }, [mapSurfaceSize, activeSubzoneCode, hoveredInView, hoveredSubzoneCode, scoreCells, visibleCandidates]);

  useEffect(() => {
    const controls = transformControlsRef.current;
    const shell = mapShellRef.current;
    const surfaceSize = mapSurfaceSizeRef.current;

    if (!greedyDemo.open) {
      if (previousDemoOpenRef.current && controls) {
        controls.centerView(initialMapScale, 420, "easeInOutCubic");
      }
      previousDemoOpenRef.current = false;
      return;
    }

    previousDemoOpenRef.current = true;
    if (!controls || !shell || !surfaceSize.width || !surfaceSize.height) return;

    if (greedyDemo.phase === "overview") {
      controls.centerView(initialMapScale, Math.round(480 / greedyDemo.speed), "easeInOutCubic");
      return;
    }

    if (greedyDemo.phase !== "focus" || !currentGreedyStep) return;
    const localX = currentGreedyStep.station.x - viewBounds.minX + 0.5;
    const localY = currentGreedyStep.station.y - viewBounds.minY + 0.5;
    const baseCellSize = Math.min(surfaceSize.width / viewColumns, surfaceSize.height / viewRows);
    const targetScale = Math.min(
      MAX_MAP_SCALE,
      Math.max(initialMapScale, DEMO_TARGET_CELL_PX / baseCellSize),
    );
    const positionX = shell.clientWidth / 2 - (localX / viewColumns) * surfaceSize.width * targetScale;
    const positionY = shell.clientHeight / 2 - (localY / viewRows) * surfaceSize.height * targetScale;
    controls.setTransform(
      positionX,
      positionY,
      targetScale,
      Math.round(560 / greedyDemo.speed),
      "easeInOutCubic",
    );
  }, [currentGreedyStep, greedyDemo.open, greedyDemo.phase, greedyDemo.speed, initialMapScale, mapSurfaceSize, viewBounds.minX, viewBounds.minY, viewColumns, viewRows]);

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
      const stationCoverage = cell.water || cell.outside ? 0 : getStationCoverage(cell, placed);

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
            className={`map-export-button greedy-demo-button ${greedyDemo.open ? "is-active" : ""}`}
            data-testid="greedy-demo-button"
            type="button"
            title="Animate how the greedy algorithm chooses shelter sites"
            aria-label="Start greedy algorithm decision demo"
            disabled={greedyDemo.status === "solving"}
            onClick={onStartGreedyDemo}
          >
            {greedyDemo.status === "solving" ? <LoaderCircle className="is-spinning" size={15} /> : <Play size={15} />}
            <span>{greedyDemo.status === "solving" ? "Preparing" : "Greedy demo"}</span>
          </button>
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
          maxScale={MAX_MAP_SCALE}
          centerOnInit
          limitToBounds={false}
          smooth={false}
          wheel={{ step: 0.22, activationKeys: ["Control"] }}
          panning={{ velocityDisabled: true }}
          doubleClick={{ mode: "zoomIn", step: 2.5, animationTime: 0 }}
          zoomAnimation={{ disabled: true }}
          autoAlignment={{ disabled: true }}
          velocityAnimation={{ disabled: true }}
          onTransform={(_, state) => {
            const nextTransform = {
              scale: state.scale,
              positionX: state.positionX,
              positionY: state.positionY,
            };
            mapTransformRef.current = nextTransform;
            syncMapOverlay(nextTransform);
            syncScoreViewport(nextTransform);
            const nextCellDetail = state.scale >= 3.5;
            if (nextCellDetail !== cellDetailRef.current) {
              cellDetailRef.current = nextCellDetail;
              setIsCellDetail(nextCellDetail);
            }
          }}
        >
          {(controls) => {
            transformControlsRef.current = controls;
            const { zoomIn, zoomOut, centerView } = controls;
            return (
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
                  className={`canvas-map ${isCellDetail ? "is-cell-detail" : ""}`}
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
                  ref={mapOverlayRef}
                  className="map-interaction-overlay"
                >
                  {hoveredSubzoneBoundaryPath && (
                    <svg
                      className="subzone-boundary-highlight"
                      data-map-boundary="true"
                      viewBox={`0 0 ${viewColumns} ${viewRows}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <path d={hoveredSubzoneBoundaryPath} vectorEffect="non-scaling-stroke" />
                    </svg>
                  )}

                  {hoveredInView && (
                    <span
                      className="map-cell-highlight"
                      data-testid="map-cell-highlight"
                      data-map-cell="true"
                      data-map-x={hoveredInView.x}
                      data-map-y={hoveredInView.y}
                    />
                  )}

                  {scoreCells.map((cell) => {
                    const score = cell.water || cell.outside
                      ? 0
                      : scoreCell(cell, weights, enabled, placed);
                    const isDemoTarget = currentGreedyStep?.station.id === cell.id;
                    return (
                      <span
                        className={`map-cell-score ${score <= 0 ? "is-zero" : ""} ${isDemoTarget ? "is-demo-target" : ""} ${isDemoTarget && greedyDemo.phase === "applied" ? "is-changing" : ""}`}
                        data-testid="map-cell-score"
                        data-map-cell="true"
                        data-map-x={cell.x}
                        data-map-y={cell.y}
                        key={cell.id}
                        aria-hidden="true"
                      >
                        {score}
                      </span>
                    );
                  })}

                  {!activeSubzone && MAP_SUBZONES.map((subzone) => (
                    <button
                      className="subzone-map-label"
                      key={subzone.code}
                      type="button"
                      data-map-x={subzone.x}
                      data-map-y={subzone.y}
                      title={`Open ${subzone.name} subzone`}
                      onMouseEnter={() => setHoveredSubzoneCode(subzone.code)}
                      onMouseLeave={() => setHoveredSubzoneCode(null)}
                      onFocus={() => setHoveredSubzoneCode(subzone.code)}
                      onBlur={() => setHoveredSubzoneCode(null)}
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
                    const isDemoCurrent = currentGreedyStep?.station.id === candidate.id;
                    const isDemoDetail = isDemoCurrent && ["focus", "applied"].includes(greedyDemo.phase);
                    return (
                      <button
                        className={`map-site-marker ${isStation ? "is-station" : ""} ${selected?.id === candidate.id ? "is-selected" : ""} ${isDemoCurrent ? "is-demo-current" : ""} ${isDemoDetail ? "is-demo-detail" : ""}`}
                        key={candidate.id}
                        type="button"
                        data-map-x={candidate.x}
                        data-map-y={candidate.y}
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
            );
          }}
        </TransformWrapper>

        <ShelterRoster
          placed={placed}
          candidates={candidates}
          cells={cells}
          selected={selected}
          visible={isRosterVisible}
          onSelect={onSelect}
          onHide={() => setIsRosterVisible(false)}
        />

        {!isRosterVisible && (
          <button
            className="floating-window-restore"
            data-export-ignore="true"
            type="button"
            title="Show built shelters window"
            aria-label="Show built shelters window"
            onClick={() => setIsRosterVisible(true)}
          >
            <MapPinned size={16} />
            <strong>{placed.length}</strong>
          </button>
        )}

        <GreedyDemoPanel
          demo={greedyDemo}
          currentStep={currentGreedyStep}
          onToggle={onToggleGreedyDemo}
          onStep={onStepGreedyDemo}
          onRestart={onRestartGreedyDemo}
          onClose={onCloseGreedyDemo}
          onSpeed={onGreedyDemoSpeed}
        />

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
