/**
 * Alternate screen buffer helper. Mirrors what htop/vim/btop/lazygit do:
 * on entry the terminal switches to a fresh buffer, on exit it restores
 * the user's pre-launch shell with no TUI residue. Without this, agenthud's
 * rendered tree stays on screen after `q` and viewers can't tell whether
 * the process is still running.
 *
 * Idempotent: enter() / leave() each only fire once even if called multiple
 * times. leave() is auto-registered on the common exit paths.
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
