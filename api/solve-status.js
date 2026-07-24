import { readStoredResult } from "./_solverStore.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed." });
  }
  const jobId = Array.isArray(request.query.id) ? request.query.id[0] : request.query.id;
  if (!jobId || !/^[a-z0-9/-]+$/i.test(jobId)) {
    return response.status(400).json({ error: "A valid job id is required." });
  }

  try {
    const result = await readStoredResult(jobId);
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json(result
      ? { status: "complete", jobId, result }
      : { status: "pending", jobId });
  } catch (error) {
    console.error("Unable to read solver result", error);
    return response.status(500).json({
      status: "failed",
      jobId,
      error: error instanceof Error ? error.message : "Unable to read solver result.",
    });
  }
}
