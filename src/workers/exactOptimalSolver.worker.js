import { solveExactOptimal } from "../model/exactOptimalCore.js";

self.onmessage = ({ data }) => {
  const { id, ...input } = data;
  try {
    const result = solveExactOptimal({
      ...input,
      onProgress: (progress) => self.postMessage({ id, progress }),
    });
    self.postMessage({ id, ...result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
