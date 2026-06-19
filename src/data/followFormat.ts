/**
 * Formatters for `agenthud follow`: `formatJson()` (the stable NDJSON
 * supervisor contract) and `formatHuman()` (a plain, pipe-safe
 * `tail -f`-style line).
 *
 * Design decision:
 * - `formatHuman` is intentionally plain (no color/padding/borders) so
 *   it stays trivially testable and safe to pipe; coloring is a
 *   deferred enhancement.
 */

import type { FollowEvent } from "./followTypes.js";

export function formatJson(e: FollowEvent): string {
  return JSON.stringify(e);
}

function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Collapse newlines/tabs so one event is always exactly one line —
 * activity `detail` can be the raw multi-line text of a response or a
 * multi-line shell command, which would otherwise split the stream. */
function flatten(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").trim();
}

export function formatHuman(e: FollowEvent): string {
  const who = [e.project, e.session.slice(0, 8), e.subagent ?? undefined]
    .filter(Boolean)
    .join("/");
  let what: string;
  if (e.type === "activity") {
    what = `${e.label}  ${e.detail ? flatten(e.detail) : ""}`.trimEnd();
  } else if (e.type === "state") {
    what = `${e.to ?? "idle"}  (was ${e.from ?? "idle"})`;
  } else {
    what = e.kind ?? "lifecycle";
  }
  return `[${clock(e.ts)}] ${who}  ${what}`;
}
