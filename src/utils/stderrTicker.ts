/**
 * Live "still working" feedback on stderr while a long-running task
 * (LLM call, big build, etc.) blocks. Renders the same line repeatedly
 * using a carriage return so the spinner doesn't scroll past the
 * pre-line content.
 *
 * Use case in agenthud: when --open suppresses the streamed claude
 * output, the user is otherwise staring at a frozen-looking terminal
 * for 30–60+ seconds. A ticking line tells them the process is alive.
 */

/** Pure helper used to render the ticker line. Exported for testing. */
export function formatTickerLine(
  label: string,
  elapsedSeconds: number,
  dots: number,
): string {
  // dots ∈ [0..3]; pad to 3 chars so the trailing text doesn't jitter.
  const tail = ".".repeat(dots % 4).padEnd(3, " ");
  return `${label}${tail} ${elapsedSeconds}s`;
}

/**
 * Start writing a ticker to stderr. Returns a `stop()` function that
 * clears the line and stops the interval. Safe to call stop() even if
 * the ticker never wrote anything (e.g. the task finished before the
 * first tick).
 */
export function startStderrTicker(
  label: string,
  options: { intervalMs?: number; stream?: NodeJS.WritableStream } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 500;
  const stream = options.stream ?? process.stderr;
  const start = Date.now();
  let ticks = 0;

  const id = setInterval(() => {
    ticks++;
    const elapsed = Math.floor((Date.now() - start) / 1000);
    stream.write(`\r${formatTickerLine(label, elapsed, ticks)}`);
  }, intervalMs);

  return function stop(): void {
    clearInterval(id);
    // Wipe whatever the spinner wrote so the next stderr line starts
    // clean at column 0. \r returns to column start, \x1b[K erases to
    // end-of-line.
    if (ticks > 0) stream.write("\r\x1b[K");
  };
}
