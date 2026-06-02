/**
 * 阶段耗时统计
 */
export function createTimer() {
  const start = performance.now();
  return {
    elapsedMs() {
      return Math.round(performance.now() - start);
    },
    elapsedSec() {
      return Math.round((performance.now() - start) / 10) / 100;
    },
  };
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
