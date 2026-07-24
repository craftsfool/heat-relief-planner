import { handleCallback } from "@vercel/queue";
import { solveGlobalConfiguration } from "../src/model/globalSolverCore.js";
import { getSolverKey, normalizeSolverConfig } from "../src/model/solverTask.js";
import { readStoredResult, writeStoredResult } from "./_solverStore.js";

export const POST = handleCallback(async (message) => {
  const config = normalizeSolverConfig(message?.config);
  const jobId = message?.jobId || getSolverKey(config);
  if (await readStoredResult(jobId)) return;

  const record = solveGlobalConfiguration(config, {
    source: "vercel-queue",
    refinementLimit: 10,
    onProgress: (progress) => {
      if (progress.phase === "exact" && progress.nodes % 100_000 === 0) {
        console.log("Solver progress", jobId, progress);
      }
    },
  });
  await writeStoredResult(jobId, record);
}, {
  visibilityTimeoutSeconds: 300,
});
