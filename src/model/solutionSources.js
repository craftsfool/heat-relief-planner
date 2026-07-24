import {
  getSolverKey,
  getStaticSolutionPath,
  normalizeSolverConfig,
  validateSolutionRecord,
} from "./solverTask.js";

const POLL_INTERVAL_MS = 1800;
const REMOTE_TIMEOUT_MS = 240_000;

const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

const readJsonResponse = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Solver request failed (${response.status}).`);
  }
  return body;
};

export async function loadPrecomputedSolution(config) {
  const normalized = normalizeSolverConfig(config);
  const response = await fetch(getStaticSolutionPath(normalized), { cache: "force-cache" });
  if (response.status === 404) return null;
  const record = await readJsonResponse(response);
  return validateSolutionRecord(record, normalized) ? record : null;
}

export async function requestQueuedSolution(config, { onProgress } = {}) {
  const normalized = normalizeSolverConfig(config);
  const submission = await readJsonResponse(await fetch("/api/solve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(normalized),
  }));
  if (submission.result && validateSolutionRecord(submission.result, normalized)) {
    return submission.result;
  }

  const jobId = submission.jobId || getSolverKey(normalized);
  const startedAt = Date.now();
  while (Date.now() - startedAt < REMOTE_TIMEOUT_MS) {
    onProgress?.({
      phase: "remote",
      jobId,
      elapsedMs: Date.now() - startedAt,
    });
    await wait(POLL_INTERVAL_MS);
    const status = await readJsonResponse(await fetch(
      `/api/solve-status?id=${encodeURIComponent(jobId)}`,
      { cache: "no-store" },
    ));
    if (status.status === "complete" && validateSolutionRecord(status.result, normalized)) {
      return status.result;
    }
    if (status.status === "failed") {
      throw new Error(status.error || "The remote solver failed.");
    }
  }
  throw new Error("The remote solver timed out; switching to the browser solver.");
}
