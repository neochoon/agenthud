/**
 * Alternate screen buffer (`\x1b[?1049h` / `l`) entry, exit, and
 * signal-handler installation. Mirrors what htop, vim, btop, and
 * lazygit do: on entry the terminal switches to a fresh buffer; on
 * exit the user's pre-launch shell is restored with no TUI residue.
 *
 * Design decisions:
 * - Idempotent. `enterAltScreen()` / `leaveAltScreen()` each only
 *   write once regardless of how many times they're called.
 *   Otherwise duplicate handler registration (every Ink re-render
 *   on hot module reload during dev) would write the escape
 *   sequence repeatedly.
 * - `installAltScreenCleanup` registers leave on every common
 *   exit path: normal exit, SIGINT (Ctrl+C, exit 130), SIGTERM
 *   (exit 143), and `uncaughtException`.
 * - The uncaught-exception handler re-throws via `setImmediate`
 *   after restoring the terminal. The async re-throw ensures node
 *   still exits non-zero AND prints the trace itself — without
 *   `setImmediate`, the trace would race the alt-screen restore
 *   and land on the buried TUI underneath.
 *
 * Gotcha:
 * - `process.on("exit")` handlers MUST be synchronous. A direct
 *   `process.stdout.write` is fine; anything async (e.g. an
 *   `await` or a `setTimeout`) silently no-ops because node is
 *   already tearing down.
 */

const ENTER = "\x1b[?1049h";
const LEAVE = "\x1b[?1049l";

let entered = false;
let left = false;

export function enterAltScreen(): void {
  if (entered) return;
  entered = true;
  process.stdout.write(ENTER);
}

export function leaveAltScreen(): void {
  if (left || !entered) return;
  left = true;
  process.stdout.write(LEAVE);
}

let hooksInstalled = false;

/**
 * Install global handlers so the alt-screen is always restored, regardless
 * of how the process exits (normal, Ctrl+C, SIGTERM, uncaught exception).
 */
export function installAltScreenCleanup(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  // Normal exit (process.exit or natural end). `exit` handlers must be
  // synchronous — direct stdout.write is fine.
  process.on("exit", () => {
    leaveAltScreen();
  });

  // Ctrl+C: write LEAVE, then let the default behavior happen by exiting.
  process.on("SIGINT", () => {
    leaveAltScreen();
    process.exit(130);
  });

  // SIGTERM: same as SIGINT but with the conventional 143 code.
  process.on("SIGTERM", () => {
    leaveAltScreen();
    process.exit(143);
  });

  // Last-ditch: if anything throws past the React/Ink boundary, restore
  // the terminal before the stack trace prints so the trace lands on
  // the user's normal shell, not over the buried TUI.
  process.on("uncaughtException", (err) => {
    leaveAltScreen();
    // Re-throw asynchronously so node still exits with non-zero status
    // and prints the trace itself.
    setImmediate(() => {
      throw err;
    });
  });
}
