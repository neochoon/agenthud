/**
 * Live "still working" feedback on stderr while a long-running task
 * blocks. Used during `claude -p` summary calls, especially when
 * `--open` suppresses the streamed LLM output and the user would
 * otherwise stare at a frozen-looking terminal for 30–60+ seconds.
 *
 * Design decisions:
 * - Uses `\r` (carriage return) instead of newlines so the ticker
 *   updates in place — doesn't scroll the pre-spinner content out
 *   of view, doesn't fill the terminal with redraw lines.
 * - Dot count is padded to 3 cells (`. `, `..`, `...`, `   `) so
 *   the trailing elapsed-seconds text stays at the same column
 *   regardless of which dot frame is current. Without the pad the
 *   `12s` jitters left and right as dots cycle.
 * - `stop()` only erases the line if the ticker actually wrote
 *   anything. Safe to call `stop()` even when the task finished
 *   before the first tick — no spurious blank line in stderr.
 *
 * Gotcha:
 * - The erase sequence is `\r\x1b[K` (return to col 0, erase to
 *   end-of-line). Without the `\x1b[K`, a long ticker line
 *   (`"sending to claude... 47s"`) could leave trailing chars
 *   behind the next stderr write if it's shorter than the
 *   ticker's last frame.
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
