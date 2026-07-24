import { list, put } from "@vercel/blob";

const RESULT_PREFIX = "solver-results/";

export const resultPathFor = (jobId) => `${RESULT_PREFIX}${jobId}.json`;

export async function readStoredResult(jobId) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const pathname = resultPathFor(jobId);
  const result = await list({ prefix: pathname, limit: 1 });
  const blob = result.blobs.find((item) => item.pathname === pathname);
  if (!blob) return null;
  const response = await fetch(blob.url, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

export async function writeStoredResult(jobId, record) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured.");
  }
  return put(resultPathFor(jobId), JSON.stringify(record), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}
