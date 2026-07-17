import { useCallback, useEffect, useRef, useState } from "react";
import { scoreCell } from "../model/cityModel";

const FRAME_RATE = 20;
const SCORE_LABEL_MIN_CELL_PX = 28;

const pickMimeType = () => [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
].find((type) => window.MediaRecorder?.isTypeSupported(type)) ?? "";

const drawRecordingFrame = (context, width, height, sourceCanvas, transform, data) => {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#dfe8ef";
  context.fillRect(0, 0, width, height);
  if (!sourceCanvas || !data.surfaceSize.width || !data.surfaceSize.height) return;

  const scaledMapWidth = data.surfaceSize.width * transform.scale;
  const scaledMapHeight = data.surfaceSize.height * transform.scale;
  const screenCellWidth = scaledMapWidth / data.viewColumns;
  const screenCellHeight = scaledMapHeight / data.viewRows;
  const screenCellSize = Math.min(screenCellWidth, screenCellHeight);
  const cellRect = (cell) => ({
    left: transform.positionX + ((cell.x - data.viewBounds.minX) / data.viewColumns) * scaledMapWidth,
    top: transform.positionY + ((cell.y - data.viewBounds.minY) / data.viewRows) * scaledMapHeight,
    width: screenCellWidth,
    height: screenCellHeight,
  });

  context.imageSmoothingEnabled = false;
  context.drawImage(
    sourceCanvas,
    transform.positionX,
    transform.positionY,
    scaledMapWidth,
    scaledMapHeight,
  );

  if (screenCellSize >= SCORE_LABEL_MIN_CELL_PX) {
    const fontSize = Math.min(34, Math.max(9, screenCellSize * 0.34));
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `800 ${fontSize}px Arial, sans-serif`;
    for (const cell of data.scoreCells) {
      const rect = cellRect(cell);
      const score = cell.water || cell.outside ? 0 : scoreCell(cell, data.weights, data.enabled, data.placed);
      const isTarget = data.currentStep?.station.id === cell.id;
      if (isTarget) {
        context.strokeStyle = "rgba(26, 96, 201, .78)";
        context.lineWidth = 2;
        context.strokeRect(rect.left + 1, rect.top + 1, rect.width - 2, rect.height - 2);
      }
      context.fillStyle = score <= 0 ? "rgba(53, 75, 94, .28)" : isTarget ? "rgba(8, 66, 148, .9)" : "rgba(24, 50, 76, .56)";
      context.fillText(String(score), rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  }

  const placedIds = new Set(data.placed.map((station) => station.id));
  const beaconSize = Math.min(72, Math.max(16, screenCellSize * 0.65));
  for (const candidate of data.visibleCandidates) {
    const rect = cellRect(candidate);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const isStation = placedIds.has(candidate.id);
    const isDetailTarget = data.currentStep?.station.id === candidate.id && ["focus", "applied"].includes(data.phase);
    context.beginPath();
    context.arc(centerX, centerY, beaconSize / 2, 0, Math.PI * 2);
    if (isDetailTarget) {
      context.fillStyle = "rgba(255,255,255,.18)";
      context.fill();
      context.strokeStyle = isStation ? "#0f806d" : "#123f9e";
      context.lineWidth = Math.min(3, Math.max(2, screenCellSize * 0.045));
      context.stroke();
      continue;
    }
    context.fillStyle = isStation ? "#0f806d" : "#1f5fd6";
    context.fill();
    context.fillStyle = "#fff";
    context.font = `800 ${Math.min(42, Math.max(9, screenCellSize * 0.38))}px Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(data.candidateIndex.get(candidate.id) ?? ""), centerX, centerY);
  }

  const title = `${data.mapName} · 20 m grid`;
  context.font = "700 11px Arial, sans-serif";
  const titleWidth = context.measureText(title).width + 18;
  context.fillStyle = "rgba(255,255,255,.9)";
  context.fillRect(12, 12, titleWidth, 26);
  context.fillStyle = "#29415e";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(title, 21, 25);
};

export function useDemoRecording({ mapShellRef, canvasRef, mapTransformRef, frameDataRef }) {
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const recordingCanvasRef = useRef(null);
  const animationFrameRef = useRef(0);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef(0);
  const suppressResultRef = useRef(false);
  const audioContextRef = useRef(null);
  const audioDestinationRef = useRef(null);
  const resultUrlRef = useRef("");

  const ensureAudio = useCallback(async () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
      audioDestinationRef.current = audioContextRef.current.createMediaStreamDestination();
    }
    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  }, []);

  const discardResult = useCallback(() => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = "";
    setResult(null);
    setStatus("idle");
  }, []);

  const cleanStream = useCallback(() => {
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recordingCanvasRef.current?.remove();
    recordingCanvasRef.current = null;
    recorderRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") return true;
    discardResult();
    const shell = mapShellRef.current;
    const sourceCanvas = canvasRef.current;
    if (!shell || !sourceCanvas || !window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setStatus("unavailable");
      return false;
    }

    try {
      await ensureAudio();
    } catch {
      // Video recording remains available when audio output is blocked.
    }
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.round(shell.clientWidth));
    const height = Math.max(2, Math.round(shell.clientHeight));
    const recordingCanvas = document.createElement("canvas");
    recordingCanvas.width = Math.round(width * pixelRatio);
    recordingCanvas.height = Math.round(height * pixelRatio);
    recordingCanvas.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;opacity:.001;pointer-events:none`;
    document.body.appendChild(recordingCanvas);
    recordingCanvasRef.current = recordingCanvas;
    const context = recordingCanvas.getContext("2d");
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const stream = recordingCanvas.captureStream(FRAME_RATE);
    const videoTrack = stream.getVideoTracks()[0];

    const render = () => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawRecordingFrame(
        context,
        width,
        height,
        sourceCanvas,
        mapTransformRef.current,
        frameDataRef.current,
      );
      videoTrack?.requestFrame?.();
      animationFrameRef.current = window.requestAnimationFrame(render);
    };
    render();
    const mimeType = pickMimeType();
    let recorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      cleanStream();
      setStatus("unavailable");
      return false;
    }
    chunksRef.current = [];
    suppressResultRef.current = false;
    startedAtRef.current = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const duration = Date.now() - startedAtRef.current;
      const chunks = chunksRef.current;
      cleanStream();
      if (suppressResultRef.current || !chunks.length) {
        setStatus("idle");
        return;
      }
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      setResult({
        blob,
        duration,
        mimeType: blob.type,
        url,
      });
      setStatus("ready");
    };
    recorderRef.current = recorder;
    streamRef.current = stream;
    recorder.start(500);
    setStatus("recording");
    return true;
  }, [canvasRef, cleanStream, discardResult, ensureAudio, frameDataRef, mapShellRef, mapTransformRef]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    suppressResultRef.current = false;
    setStatus("processing");
    try {
      recorder.requestData();
    } catch {
      // Some MediaRecorder implementations only emit data during stop.
    }
    window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, 120);
  }, []);

  const cancelRecording = useCallback(() => {
    const recorder = recorderRef.current;
    suppressResultRef.current = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else cleanStream();
    setStatus("idle");
  }, [cleanStream]);

  const playSelectionSound = useCallback(async () => {
    let audioContext;
    try {
      audioContext = await ensureAudio();
    } catch {
      return;
    }
    if (!audioContext) return;
    const now = audioContext.currentTime;
    [620, 930].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = index ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.12, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(index ? 0.025 : 0.045, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      if (audioDestinationRef.current) gain.connect(audioDestinationRef.current);
      oscillator.start(now + index * 0.035);
      oscillator.stop(now + 0.34);
    });
  }, [ensureAudio]);

  const saveResult = useCallback(() => {
    if (!result) return;
    const extension = result.mimeType.includes("mp4") ? "mp4" : "webm";
    const link = document.createElement("a");
    link.href = result.url;
    link.download = `heat-relief-greedy-demo-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.${extension}`;
    link.click();
    discardResult();
  }, [discardResult, result]);

  useEffect(() => () => {
    window.clearTimeout(stopTimerRef.current);
    window.cancelAnimationFrame(animationFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recordingCanvasRef.current?.remove();
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    audioContextRef.current?.close();
  }, []);

  return {
    status,
    result,
    startRecording,
    stopRecording,
    cancelRecording,
    playSelectionSound,
    saveResult,
    discardResult,
  };
}
