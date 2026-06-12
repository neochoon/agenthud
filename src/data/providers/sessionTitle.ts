/**
 * Shared session-title selection so every provider's row
 * description means the same thing: the LATEST substantial user
 * message, not the first prompt and not an auto-generated session
 * label.
 *
 * Rule (matches the Claude provider's `readFirstUserPrompt`):
 *   1. Prefer the latest user message that isn't a slash command
 *      (`/model`, `/compact`, …) — for a long session this reflects
 *      what the user is doing now, not what they opened with.
 *   2. Fall back to the first user message when every later one is a
 *      slash command (or there's only one).
 *
 * Callers pass the user messages in chronological order and an
 * optional `isNoise` predicate to drop synthetic turns (Codex's
 * `<environment_context>` block, Claude's `<system-reminder>`, …).
 */
export function pickLatestUserTitle(
  messages: string[],
  isNoise: (text: string) => boolean = () => false,
): string | null {
  let first: string | null = null;
  let latestNonSlash: string | null = null;

  for (const message of messages) {
    if (!message) continue;
    const firstLine = message.split("\n").find((l) => l.trim()) ?? "";
    if (!firstLine || isNoise(firstLine) || isNoise(message)) continue;
    if (first === null) first = firstLine;
    if (!firstLine.trim().startsWith("/")) latestNonSlash = firstLine;
  }

  return latestNonSlash ?? first;
}
