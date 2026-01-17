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
