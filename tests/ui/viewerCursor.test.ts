import { describe, expect, it } from "vitest";
import {
  adjustViewerCursorOnNewActivities,
  scrollOffsetForCursor,
} from "../../src/ui/viewerCursor.js";

describe("adjustViewerCursorOnNewActivities", () => {
  // Contract reminder: viewerCursorLine counts rows from the LIVE EDGE
  // (the bottom of the tail-feed viewer). cursorLine = 0 means "on the
  // live row"; cursorLine = viewerRows - 1 means "at the top of the
  // visible window" (oldest visible).
  //
  // Result shape: { cursorLine, autoPause, scrollDelta }
  // autoPause is set when the cursor's anchored activity would scroll
  // off the top of the viewport — at that point the viewer transitions
  // to PAUSED and scrollDelta is the count of new entries that became
  // "scrolled past" the visible window.

  it("returns no-op when not in LIVE mode", () => {
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
    ).toEqual({ cursorLine: 3, autoPause: false, scrollDelta: 0 });
  });

  it("returns cursorLine 0 when cursor is already on the live row", () => {
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
    ).toEqual({ cursorLine: 0, autoPause: false, scrollDelta: 0 });
  });

  it("returns no-op when no new activities arrived", () => {
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 4,
        prevActivityCount: 10,
        newActivityCount: 10,
        isLive: true,
        viewerRows: 20,
      }),
    ).toEqual({ cursorLine: 4, autoPause: false, scrollDelta: 0 });
  });

  it("returns no-op when activity count shrank (defensive)", () => {
    // Filter change can drop entries; the existing filter-change reset
    // handles cursor in that path, so we just no-op here.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 5,
        prevActivityCount: 20,
        newActivityCount: 12,
        isLive: true,
        viewerRows: 20,
      }),
    ).toEqual({ cursorLine: 5, autoPause: false, scrollDelta: 0 });
  });

  it("moves cursor up by the number of new entries when room remains", () => {
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
    ).toEqual({ cursorLine: 5, autoPause: false, scrollDelta: 0 });
  });

  it("handles a single new entry (the common live case)", () => {
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 4,
        prevActivityCount: 42,
        newActivityCount: 43,
        isLive: true,
        viewerRows: 20,
      }),
    ).toEqual({ cursorLine: 5, autoPause: false, scrollDelta: 0 });
  });

  it("auto-pauses when the cursor's activity would scroll past the top", () => {
    // Cursor at row 18 in a 20-row viewer; max = 19; upward room = 1.
    // 5 new activities arrive — first 1 lifts cursor to row 19 (top),
    // remaining 4 push the cursor's activity off the visible window
    // → auto-pause, scrollDelta = 4 (those 4 entries became scrolled-
    // past in the new PAUSED snapshot).
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 18,
        prevActivityCount: 10,
        newActivityCount: 15,
        isLive: true,
        viewerRows: 20,
      }),
    ).toEqual({ cursorLine: 19, autoPause: true, scrollDelta: 4 });
  });

  it("auto-pauses immediately when cursor is already at the top row", () => {
    // Cursor at max (row 19 in a 20-row viewer); upward room = 0.
    // Any number of new entries triggers auto-pause; ALL of them
    // become the scroll offset since none consumed upward room.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 19,
        prevActivityCount: 10,
        newActivityCount: 13,
        isLive: true,
        viewerRows: 20,
      }),
    ).toEqual({ cursorLine: 19, autoPause: true, scrollDelta: 3 });
  });

  it("auto-pauses exactly when delta consumes all remaining upward room", () => {
    // Edge case: cursor at 17, max = 19, room = 2, delta = 2.
    // Cursor reaches the top exactly, no overflow → still LIVE.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 17,
        prevActivityCount: 10,
        newActivityCount: 12,
        isLive: true,
        viewerRows: 20,
      }),
    ).toEqual({ cursorLine: 19, autoPause: false, scrollDelta: 0 });
  });

  it("auto-pauses with delta = upwardRoom + 1 (just over the line)", () => {
    // Cursor at 17, max = 19, room = 2, delta = 3.
    // 2 consumed lifting cursor to 19, 1 overflows → auto-pause,
    // scrollDelta = 1.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 17,
        prevActivityCount: 10,
        newActivityCount: 13,
        isLive: true,
        viewerRows: 20,
      }),
    ).toEqual({ cursorLine: 19, autoPause: true, scrollDelta: 1 });
  });

  it("handles a viewer with only one row gracefully", () => {
    // Pathological case: viewer height clamped to 1. max = 0, so
    // cursor === 0 always. The cursor-on-live-row short-circuit
    // catches this before the overflow path.
    expect(
      adjustViewerCursorOnNewActivities({
        prevCursorLine: 0,
        prevActivityCount: 5,
        newActivityCount: 8,
        isLive: true,
        viewerRows: 1,
      }),
    ).toEqual({ cursorLine: 0, autoPause: false, scrollDelta: 0 });
  });
});

describe("scrollOffsetForCursor", () => {
  it("places a mid-history hit: raw = total - 1 - hitIndex, clamped to total - viewerRows", () => {
    // 100 activities, viewerRows = 20, hitIndex = 10 (deep in history)
    // raw = 100 - 1 - 10 = 89; max = max(0, 100 - 20) = 80; clamped to 80
    expect(scrollOffsetForCursor(100, 10, 20)).toBe(80);
  });

  it("clamps to max(0, total - viewerRows) when hitIndex is very old", () => {
    // 100 activities, viewerRows = 20, hitIndex = 0 (oldest)
    // raw = 99, max = 80 → clamped to 80
    expect(scrollOffsetForCursor(100, 0, 20)).toBe(80);
  });

  it("returns 0 when hit is in the live-edge window (near newest)", () => {
    // 100 activities, viewerRows = 20, hitIndex = 99 (newest)
    // raw = 0 → scrollOffset = 0 (live edge)
    expect(scrollOffsetForCursor(100, 99, 20)).toBe(0);
  });

  it("returns a non-zero within-window offset when hit is near (but not at) the live edge", () => {
    // hitIndex = 85 in a 100-item list with viewerRows = 20
    // raw = 100 - 1 - 85 = 14; max = max(0, 100 - 20) = 80; 14 <= 80 → 14
    expect(scrollOffsetForCursor(100, 85, 20)).toBe(14);
  });

  it("handles total < viewerRows (history shorter than viewport)", () => {
    // 5 activities, viewerRows = 20, hitIndex = 0
    // raw = 4; max(0, 5-20) = 0 → clamped to 0
    expect(scrollOffsetForCursor(5, 0, 20)).toBe(0);
  });

  it("handles hitIndex = total - 1 (the newest entry)", () => {
    expect(scrollOffsetForCursor(50, 49, 10)).toBe(0);
  });
});
