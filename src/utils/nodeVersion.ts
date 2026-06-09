/**
 * Parse and validate the running Node major version; abort with a
 * friendly upgrade message if below `MIN_NODE_VERSION`.
 *
 * Design decision:
 * - This file exposes unit-testable helpers
 *   (`parseNodeMajorVersion`, `isNodeVersionSupported`) that
 *   don't fire `process.exit`. The bin entry (`src/index.ts`)
 *   deliberately duplicates the version-gate logic inline rather
 *   than importing this module, so the boot path doesn't load
 *   any project code before the Node-version check passes — which
 *   is the whole point of the gate (older Node may fail on
 *   transitive dep parse).
 */

export const MIN_NODE_VERSION = 20;

export function parseNodeMajorVersion(version: string): number {
  const match = version.match(/^v?(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function isNodeVersionSupported(majorVersion: number): boolean {
  return majorVersion >= MIN_NODE_VERSION;
}

export function checkNodeVersion(): void {
  const majorVersion = parseNodeMajorVersion(process.version);

  if (!isNodeVersionSupported(majorVersion)) {
    console.error(
      `\nError: Node.js ${MIN_NODE_VERSION}+ is required (current: ${process.version})\n`,
    );
    console.error("Please upgrade Node.js:");
    console.error("  https://nodejs.org/\n");
    process.exit(1);
  }
}
