import { describe, expect, it } from "vitest";
import { adjustViewerCursorOnNewActivities } from "../../src/ui/viewerCursor.js";

describe("adjustViewerCursorOnNewActivities", () => {
  // Contract reminder: viewerCursorLine counts rows from the LIVE EDGE
  // (the bottom of the tail-feed viewer). cursorLine = 0 means "on the
  // live row"; cursorLine = viewerRows - 1 means "at the top of the
  // visible window" (oldest visible).

  it("returns cursorLine unchanged when not in LIVE mode", () => {
    // Paused: window does not auto-scroll, so the activity at the
    // cursor's screen row hasn't changed even though new activities
    // arrived. No adjustment needed.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 3,
        prevActivityCount: 10,
        newActivityCount: 15,
        isLive: false,
        viewerRows: 20,
      }),
    ).toBe(3);
  });

  it("returns 0 when cursor is on the live row (cursorLine === 0)", () => {
    // The user explicitly hasn't moved off live — tracking the live
    // edge is the intent.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 0,
        prevActivityCount: 10,
        newActivityCount: 13,
        isLive: true,
        viewerRows: 20,
      }),
    ).toBe(0);
  });

  it("returns cursorLine unchanged when no new activities arrived", () => {
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 4,
        prevActivityCount: 10,
        newActivityCount: 10,
        isLive: true,
        viewerRows: 20,
      }),
    ).toBe(4);
  });

  it("returns cursorLine unchanged when activity count somehow shrank", () => {
    // Filter change can drop entries; the existing filter-change reset
    // handles cursor in that path, so we just no-op here defensively.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 5,
        prevActivityCount: 20,
        newActivityCount: 12,
        isLive: true,
        viewerRows: 20,
      }),
    ).toBe(5);
  });

  it("increments cursorLine by the number of new activities (LIVE mode)", () => {
    // 3 new activities in LIVE mode → live edge slid 3 rows forward,
    // so the cursor's activity is now 3 rows further from the bottom.
    // Cursor at row 2 → row 5 to stay on the same content.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 2,
        prevActivityCount: 10,
        newActivityCount: 13,
        isLive: true,
        viewerRows: 20,
      }),
    ).toBe(5);
  });

  it("clamps adjusted cursor to viewerRows - 1 (cursor would scroll off top)", () => {
    // Cursor at row 18 in a 20-row viewer; 5 new activities arrive
    // → 18 + 5 = 23, exceeds the top row 19. Clamp to 19. At this
    // point we've lost content-anchoring for that one activity, but
    // staying in the viewport beats vanishing.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 18,
        prevActivityCount: 10,
        newActivityCount: 15,
        isLive: true,
        viewerRows: 20,
      }),
    ).toBe(19);
  });

  it("handles a single new activity (the common live case)", () => {
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 4,
        prevActivityCount: 42,
        newActivityCount: 43,
        isLive: true,
        viewerRows: 20,
      }),
    ).toBe(5);
  });

  it("handles a viewer with only one row gracefully", () => {
    // Pathological case: viewer height clamped to 1. Cursor can only
    // be 0; should never adjust above 0.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 0,
        prevActivityCount: 5,
        newActivityCount: 8,
        isLive: true,
        viewerRows: 1,
      }),
    ).toBe(0);
  });
});
