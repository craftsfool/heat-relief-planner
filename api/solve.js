import { send } from "@vercel/queue";
import {
  getSolverKey,
  normalizeSolverConfig,
} from "../src/model/solverTask.js";
import { readStoredResult } from "./_solverStore.js";

const QUEUE_TOPIC = "heat-relief-global-solver";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed." });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return response.status(503).json({
      error: "Remote solver storage is not configured; use the browser fallback.",
    });
  }

  try {
    const config = normalizeSolverConfig(request.body);
    const jobId = getSolverKey(config);
    const cached = await readStoredResult(jobId);
    if (cached) return response.status(200).json({ status: "complete", jobId, result: cached });

    const queued = await send(QUEUE_TOPIC, { jobId, config }, { region: "sin1" });
    return response.status(202).json({
      status: "queued",
      jobId,
      messageId: queued.messageId,
    });
  } catch (error) {
    console.error("Unable to queue solver job", error);
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to queue solver job.",
    });
  }
}
