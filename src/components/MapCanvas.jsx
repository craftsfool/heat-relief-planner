import {
  ArrowLeft,
  BookOpen,
  Building2,
  Check,
  Coffee,
  Download,
  LoaderCircle,
  Maximize2,
  Play,
  ShoppingBasket,
  Store,
  Trash2,
  Utensils,
  Video,
  Waves,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { toPng } from "html-to-image";
import { GreedyDemoPanel } from "./GreedyDemoPanel";
import { useDemoRecording } from "../hooks/useDemoRecording";
import {
  CELL_SIZE_METRES,
  formatLayerValue,
  getLayerIntensity,
  GRID_COLS,
  GRID_ROWS,
  MAP_EXISTING_SHELTERS,
  MAP_METADATA,
  MAP_SUBZONES,
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
const DEMO_INTRO_CELL_PX = 34;
const MAX_MAP_SCALE = 48;
const DEMO_INTRO_VIEWS = [
  { mode: "base", layer: "demand", label: "Base map" },
  { mode: "single", layer: "demand", label: "Population demand" },
  { mode: "single", layer: "cost", label: "Regional cost" },
  { mode: "single", layer: "heat", label: "Heat exposure" },
];

const FACILITY_ICONS = {
  convenience: Store,
  supermarket: ShoppingBasket,
  mall: Building2,
  cafe: Coffee,
  food_court: Utensils,
  library: BookOpen,
  community: Building2,
  water: Waves,
  shelter: Building2,
};
const OVERVIEW_FACILITY_KINDS = new Set(["mall", "supermarket", "community", "library"]);

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
  mode,
  activeLayer,
  candidates,
  selected,
  hovered,
  placed,
  demandState,
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
  onCompleteGreedyIntro,
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
  const recordingFrameDataRef = useRef(null);
  const soundedDecisionRef = useRef("");
  const introRunRef = useRef(0);
  const [exportStatus, setExportStatus] = useState("idle");
  const [hoveredSubzoneCode, setHoveredSubzoneCode] = useState(null);
  const [scoreCells, setScoreCells] = useState([]);
  const [demoIntro, setDemoIntro] = useState({ active: false, stageIndex: 0 });
  const [includeRecordingIntro, setIncludeRecordingIntro] = useState(true);
  const introView = demoIntro.active ? DEMO_INTRO_VIEWS[demoIntro.stageIndex] : null;
  const renderedMode = introView?.mode ?? mode;
  const renderedActiveLayer = introView?.layer ?? activeLayer;
  const activeSubzone = MAP_SUBZONES.find((subzone) => subzone.code === activeSubzoneCode) ?? null;

  useEffect(() => {
    const mapShell = mapShellRef.current;
    if (!mapShell) return undefined;

    // Chromium reports trackpad pinch as Ctrl+wheel. Keep that zoom gesture
    // inside the map while TransformWrapper receives the same event.
    const keepZoomInMap = (event) => {
      if (event.ctrlKey && event.cancelable) event.preventDefault();
    };
    const preventSafariGestureZoom = (event) => {
      if (event.cancelable) event.preventDefault();
    };

    mapShell.addEventListener("wheel", keepZoomInMap, {
      capture: true,
      passive: false,
    });
    mapShell.addEventListener("gesturestart", preventSafariGestureZoom, { passive: false });
    mapShell.addEventListener("gesturechange", preventSafariGestureZoom, { passive: false });

    return () => {
      mapShell.removeEventListener("wheel", keepZoomInMap, true);
      mapShell.removeEventListener("gesturestart", preventSafariGestureZoom);
      mapShell.removeEventListener("gesturechange", preventSafariGestureZoom);
    };
  }, []);

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
  const visibleExistingShelters = useMemo(
    () => MAP_EXISTING_SHELTERS.filter((shelter) =>
      viewCellByCoordinate.has(`${shelter.x}-${shelter.y}`)),
    [viewCellByCoordinate],
  );
  const visiblePlacedStations = useMemo(
    () => placed.filter((station) =>
      viewCellByCoordinate.has(`${station.x}-${station.y}`)),
    [placed, viewCellByCoordinate],
  );
  const candidateIndex = useMemo(
    () => new Map(candidates.map((candidate, index) => [candidate.id, index + 1])),
    [candidates],
  );
  const placedIds = useMemo(() => new Set(placed.map((station) => station.id)), [placed]);
  const currentGreedyStep = greedyDemo.steps[greedyDemo.stepIndex] ?? null;
  recordingFrameDataRef.current = {
    surfaceSize: mapSurfaceSizeRef.current,
    viewColumns,
    viewRows,
    viewBounds,
    scoreCells,
    mode: renderedMode,
    activeLayer: renderedActiveLayer,
    demandState,
    placed,
    visibleCandidates,
    candidateIndex,
    currentStep: currentGreedyStep,
    stepIndex: greedyDemo.stepIndex,
    totalSteps: greedyDemo.steps.length,
    phase: greedyDemo.phase,
    mapName: activeSubzone?.name ?? "Queenstown",
    tourLabel: introView?.label ?? "",
  };
  const {
    status: recordingStatus,
    result: recordingResult,
    startRecording,
    startDecisionRecording,
    stopRecording,
    cancelRecording,
    playSelectionSound,
    saveResult: saveRecording,
    discardResult: discardRecording,
  } = useDemoRecording({
    mapShellRef,
    canvasRef,
    mapTransformRef,
    frameDataRef: recordingFrameDataRef,
  });
  const selectedRecordingResult = includeRecordingIntro || !recordingResult?.withoutIntro
    ? recordingResult
    : recordingResult.withoutIntro;
  const hoveredInView = hovered && (!activeSubzone || hovered.subzoneCode === activeSubzone.code)
    ? hovered
    : null;
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
      if (element.dataset.mapRadius) {
        const diameter = (
          (Number(element.dataset.mapRadius) * 2) / CELL_SIZE_METRES
        ) * screenCellSize;
        element.style.width = `${diameter}px`;
        element.style.height = `${diameter}px`;
      }
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
    if (renderedMode !== "single" || Math.min(screenCellWidth, screenCellHeight) < SCORE_LABEL_MIN_CELL_PX) {
      scoreViewportKeyRef.current = "";
      setScoreCells((current) => current.length ? [] : current);
      return;
    }

    const shellWidth = shell.clientWidth;
    const shellHeight = shell.clientHeight;
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const minLocalX = clamp(Math.floor((-transform.positionX) / screenCellWidth) - 1, 0, viewColumns - 1);
    const maxLocalX = clamp(Math.ceil((shellWidth - transform.positionX) / screenCellWidth) + 1, 0, viewColumns - 1);
    const minLocalY = clamp(Math.floor((-transform.positionY) / screenCellHeight) - 1, 0, viewRows - 1);
    const maxLocalY = clamp(Math.ceil((shellHeight - transform.positionY) / screenCellHeight) + 1, 0, viewRows - 1);
    const nextKey = `${activeSubzoneCode ?? "queenstown"}:${renderedActiveLayer}:${minLocalX}:${maxLocalX}:${minLocalY}:${maxLocalY}`;
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
  }, [mapSurfaceSize, activeSubzoneCode, hoveredInView, hoveredSubzoneCode, isCellDetail, renderedActiveLayer, renderedMode, scoreCells, visibleCandidates, visibleExistingShelters, visiblePlacedStations]);

  useEffect(() => {
    scoreViewportKeyRef.current = "";
    if (renderedMode === "single") syncScoreViewport();
    else setScoreCells((current) => current.length ? [] : current);
  }, [renderedActiveLayer, renderedMode]);

  useEffect(() => {
    if (greedyDemo.phase !== "intro") {
      introRunRef.current += 1;
      setDemoIntro((current) => current.active ? { active: false, stageIndex: 0 } : current);
      return undefined;
    }

    const controls = transformControlsRef.current;
    const shell = mapShellRef.current;
    const surfaceSize = mapSurfaceSizeRef.current;
    if (!controls || !shell || !surfaceSize.width || !surfaceSize.height) return undefined;

    const runId = introRunRef.current + 1;
    introRunRef.current = runId;
    const timers = [];
    const schedule = (callback, delay) => {
      const timer = window.setTimeout(() => {
        if (introRunRef.current === runId) callback();
      }, delay);
      timers.push(timer);
    };

    const runIntro = async () => {
      await startRecording();
      if (introRunRef.current !== runId) return;

      const baseCellSize = Math.min(
        surfaceSize.width / viewColumns,
        surfaceSize.height / viewRows,
      );
      const targetScale = Math.min(
        MAX_MAP_SCALE,
        Math.max(initialMapScale, DEMO_INTRO_CELL_PX / baseCellSize),
      );
      const scaledWidth = surfaceSize.width * targetScale;
      const scaledHeight = surfaceSize.height * targetScale;
      const screenCellWidth = scaledWidth / viewColumns;
      const screenCellHeight = scaledHeight / viewRows;
      let minLocalX = viewColumns - 1;
      let maxLocalX = 0;
      let minLocalY = viewRows - 1;
      let maxLocalY = 0;
      for (const cell of viewCells) {
        const localX = cell.x - viewBounds.minX;
        const localY = cell.y - viewBounds.minY;
        minLocalX = Math.min(minLocalX, localX);
        maxLocalX = Math.max(maxLocalX, localX);
        minLocalY = Math.min(minLocalY, localY);
        maxLocalY = Math.max(maxLocalY, localY);
      }
      const horizontalSpan = Math.max(1, maxLocalX - minLocalX + 1);
      const edgeBand = Math.max(4, Math.round(horizontalSpan * 0.14));
      let leftYTotal = 0;
      let leftCount = 0;
      let rightYTotal = 0;
      let rightCount = 0;
      for (const cell of viewCells) {
        const localX = cell.x - viewBounds.minX;
        const localY = cell.y - viewBounds.minY + 0.5;
        if (localX <= minLocalX + edgeBand) {
          leftYTotal += localY;
          leftCount += 1;
        }
        if (localX >= maxLocalX - edgeBand) {
          rightYTotal += localY;
          rightCount += 1;
        }
      }
      const fallbackCenterY = (minLocalY + maxLocalY + 1) / 2;
      const leftCenterY = leftCount ? leftYTotal / leftCount : fallbackCenterY;
      const rightCenterY = rightCount ? rightYTotal / rightCount : fallbackCenterY;
      const margin = 18;
      const contentWidth = horizontalSpan * screenCellWidth;
      const startX = contentWidth > shell.clientWidth
        ? margin - minLocalX * screenCellWidth
        : (shell.clientWidth - contentWidth) / 2 - minLocalX * screenCellWidth;
      const endX = contentWidth > shell.clientWidth
        ? shell.clientWidth - margin - (maxLocalX + 1) * screenCellWidth
        : startX;
      const startY = shell.clientHeight / 2 - leftCenterY * screenCellHeight;
      const endY = shell.clientHeight / 2 - rightCenterY * screenCellHeight;
      const zoomDuration = Math.round(650 / greedyDemo.speed);
      const stageDuration = Math.round(900 / greedyDemo.speed);
      const panDelay = zoomDuration + Math.round(100 / greedyDemo.speed);
      const panDuration = stageDuration * DEMO_INTRO_VIEWS.length;
      const returnDuration = Math.round(680 / greedyDemo.speed);

      setDemoIntro({ active: true, stageIndex: 0 });
      controls.setTransform(
        startX,
        startY,
        targetScale,
        zoomDuration,
        "easeInOutCubic",
      );

      schedule(() => {
        controls.setTransform(
          endX,
          endY,
          targetScale,
          panDuration,
          "easeInOutCubic",
        );
      }, panDelay);

      DEMO_INTRO_VIEWS.forEach((_, stageIndex) => {
        schedule(() => setDemoIntro({ active: true, stageIndex }), panDelay + stageIndex * stageDuration);
      });

      const returnAt = panDelay + panDuration;
      schedule(() => {
        controls.centerView(initialMapScale, returnDuration, "easeInOutCubic");
      }, returnAt);
      schedule(() => {
        setDemoIntro({ active: false, stageIndex: 0 });
        startDecisionRecording();
        onCompleteGreedyIntro();
      }, returnAt + returnDuration + Math.round(120 / greedyDemo.speed));
    };

    void runIntro();
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      if (introRunRef.current === runId) introRunRef.current += 1;
    };
  }, [greedyDemo.phase, greedyDemo.speed, initialMapScale, mapSurfaceSize, onCompleteGreedyIntro, startDecisionRecording, startRecording, viewBounds.minX, viewBounds.minY, viewCells, viewColumns, viewRows]);

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
    if (["idle", "solving"].includes(greedyDemo.phase) || greedyDemo.status === "solving") {
      soundedDecisionRef.current = "";
      return;
    }
    if (greedyDemo.phase !== "applied" || !currentGreedyStep) return;
    const decisionKey = `${greedyDemo.stepIndex}:${currentGreedyStep.station.id}`;
    if (soundedDecisionRef.current === decisionKey) return;
    soundedDecisionRef.current = decisionKey;
    void playSelectionSound();
  }, [currentGreedyStep, greedyDemo.phase, greedyDemo.status, greedyDemo.stepIndex, playSelectionSound]);

  useEffect(() => {
    if (greedyDemo.status === "complete" && recordingStatus === "recording") stopRecording();
    if (greedyDemo.status === "error" && recordingStatus === "recording") cancelRecording();
  }, [cancelRecording, greedyDemo.status, recordingStatus, stopRecording]);

  useEffect(() => {
    if (recordingResult) setIncludeRecordingIntro(true);
  }, [recordingResult]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = viewColumns;
    canvas.height = viewRows;
    const context = canvas.getContext("2d", { alpha: true });
    const image = context.createImageData(viewColumns, viewRows);
    const activeDefinition = layers.find((layer) => layer.id === renderedActiveLayer);

    for (const cell of viewCells) {
      let color = getBaseColor(cell);
      if (renderedMode === "single" && activeDefinition) {
        const intensity = getLayerIntensity(cell, renderedActiveLayer, demandState);
        color = blend(
          color,
          hexToRgb(activeDefinition.color),
          intensity <= 0 ? 0 : Math.min(0.78, 0.08 + intensity * 0.7),
        );
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
  }, [demandState, layers, renderedActiveLayer, renderedMode, viewBounds.minX, viewBounds.minY, viewCells, viewColumns, viewRows]);

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

  const startRecordedGreedyDemo = () => {
    soundedDecisionRef.current = "";
    onStartGreedyDemo();
  };

  const restartRecordedGreedyDemo = () => {
    soundedDecisionRef.current = "";
    if (["recording", "processing"].includes(recordingStatus)) cancelRecording();
    onRestartGreedyDemo();
  };

  const closeRecordedGreedyDemo = () => {
    cancelRecording();
    onCloseGreedyDemo();
  };

  return (
    <main className="map-workspace">
      <div className="map-toolbar">
        <div className="segmented-control" aria-label="Map view mode">
          <button className={renderedMode === "base" ? "is-selected" : ""} disabled={demoIntro.active} onClick={() => onMode("base")} type="button">Base map</button>
          <button className={renderedMode === "single" ? "is-selected" : ""} disabled={demoIntro.active} onClick={() => onMode("single")} type="button">Single layer</button>
        </div>

        <div className="map-toolbar-meta">
          <div
            className={`map-legend ${renderedMode === "base" ? "is-hidden" : ""}`}
            aria-label="Layer intensity legend"
            style={{ "--legend-color": layers.find((layer) => layer.id === renderedActiveLayer)?.color }}
          >
            <span>{introView?.label ?? layers.find((layer) => layer.id === renderedActiveLayer)?.label}</span>
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
            onClick={startRecordedGreedyDemo}
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
                <span>
                  {MAP_METADATA.cellSizeMetres} m grid · {viewCells.length.toLocaleString()} cells · {visibleExistingShelters.length} existing shelters · {visibleCandidates.length} candidates
                </span>
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

                  {visiblePlacedStations.map((station) => (
                    <span
                      className={`station-coverage ${selected?.id === station.id ? "is-selected" : ""}`}
                      data-map-x={station.x}
                      data-map-y={station.y}
                      data-map-radius={station.radius}
                      key={`coverage-${station.id}`}
                      aria-hidden="true"
                    />
                  ))}

                  {scoreCells.map((cell) => {
                    const value = formatLayerValue(cell, renderedActiveLayer, demandState, true);
                    const isDemoTarget = currentGreedyStep?.station.id === cell.id;
                    return (
                      <span
                        className={`map-cell-score ${getLayerIntensity(cell, renderedActiveLayer, demandState) <= 0 ? "is-zero" : ""} ${isDemoTarget ? "is-demo-target" : ""} ${isDemoTarget && greedyDemo.phase === "applied" ? "is-changing" : ""}`}
                        data-testid="map-cell-score"
                        data-map-cell="true"
                        data-map-x={cell.x}
                        data-map-y={cell.y}
                        key={cell.id}
                        aria-hidden="true"
                      >
                        {value}
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

                  {visibleExistingShelters
                    .filter((shelter) =>
                      isCellDetail || activeSubzone || OVERVIEW_FACILITY_KINDS.has(shelter.kind))
                    .map((shelter) => {
                      const FacilityIcon = FACILITY_ICONS[shelter.kind] ?? Store;
                      return (
                        <span
                          className={`existing-shelter-marker kind-${shelter.kind}`}
                          key={shelter.id}
                          data-map-x={shelter.x}
                          data-map-y={shelter.y}
                          title={`${shelter.label} · existing capacity ${shelter.capacity.toLocaleString()}`}
                          aria-label={`${shelter.label}, existing shelter capacity ${shelter.capacity}`}
                          role="img"
                        >
                          <FacilityIcon aria-hidden="true" />
                        </span>
                      );
                    })}

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

        <GreedyDemoPanel
          demo={greedyDemo}
          currentStep={currentGreedyStep}
          recordingStatus={recordingStatus}
          onToggle={onToggleGreedyDemo}
          onStep={onStepGreedyDemo}
          onRestart={restartRecordedGreedyDemo}
          onClose={closeRecordedGreedyDemo}
          onSpeed={onGreedyDemoSpeed}
        />

        <div className="map-attribution">
          <a href={MAP_METADATA.boundarySource.url} target="_blank" rel="noreferrer">URA subzones</a>
          <span>·</span>
          <a href={MAP_METADATA.featureSource.url} target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        </div>

        {hoveredInView && (
          <div className="hover-readout" data-export-ignore="true" data-testid="cell-score-readout">
            <strong>{hoveredInView.zone}</strong>
            <span>Cell {hoveredInView.x + 1}, {hoveredInView.y + 1} · {hoveredInView.buildable ? "Buildable" : "Unavailable"}</span>
            <dl className="hover-layer-values">
              {(renderedMode === "single"
                ? layers.filter((layer) => layer.id === renderedActiveLayer)
                : layers
              ).map((layer) => (
                <div key={layer.id}>
                  <dt><i style={{ backgroundColor: layer.color }} />{layer.label}</dt>
                  <dd>{formatLayerValue(hoveredInView, layer.id, demandState)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {recordingResult && (
        <div className="demo-video-dialog-backdrop" role="presentation">
          <section className="demo-video-dialog" role="dialog" aria-modal="true" aria-labelledby="demo-video-title">
            <Video size={22} />
            <div>
              <span>Greedy demo complete</span>
              <h2 id="demo-video-title">Save the map recording?</h2>
              <p>{Math.max(1, Math.round(selectedRecordingResult.duration / 1000))} seconds · {(selectedRecordingResult.blob.size / 1_048_576).toFixed(1)} MB</p>
            </div>
            <label className="demo-video-intro-option">
              <input
                type="checkbox"
                checked={includeRecordingIntro}
                disabled={!recordingResult.withoutIntro}
                onChange={(event) => setIncludeRecordingIntro(event.target.checked)}
              />
              <span>
                <strong>Include map tour intro</strong>
                <small>Left-to-right data-layer overview</small>
              </span>
            </label>
            <div className="demo-video-dialog-actions">
              <button type="button" className="is-secondary" onClick={discardRecording}><Trash2 size={15} /> Discard</button>
              <button type="button" className="is-primary" onClick={() => saveRecording(includeRecordingIntro)}><Download size={15} /> Save video</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
