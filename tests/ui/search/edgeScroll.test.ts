import { describe, expect, it } from "vitest";
import { edgeScrollWindowStart } from "../../../src/ui/search/edgeScroll.js";

describe("edgeScrollWindowStart", () => {
  // total=10, visibleRows=5 → max valid start = 5
  const total = 10;
  const visibleRows = 5;

  it("keeps start stable when selection moves within the window", () => {
    // prevStart=2, window shows [2..6], selected=3 (inside) → stay at 2
    expect(edgeScrollWindowStart(2, 3, visibleRows, total)).toBe(2);
    expect(edgeScrollWindowStart(2, 4, visibleRows, total)).toBe(2);
    expect(edgeScrollWindowStart(2, 6, visibleRows, total)).toBe(2);
  });

  it("advances start by 1 when selection moves past the bottom edge", () => {
    // prevStart=2, window shows [2..6], selected=7 (just past bottom edge index 6) → newStart=3
    expect(edgeScrollWindowStart(2, 7, visibleRows, total)).toBe(3);
  });

  it("advances start minimally (not jump to selected) on each step down", () => {
    // Simulate holding ↓: each press selected advances by 1
    let start = 0;
    // selected 0..4 (inside window [0..4]) → stays at 0
    for (let s = 0; s <= 4; s++) {
      start = edgeScrollWindowStart(start, s, visibleRows, total);
      expect(start).toBe(0);
    }
    // selected=5 → bottom edge exceeded → newStart=1
    start = edgeScrollWindowStart(start, 5, visibleRows, total);
    expect(start).toBe(1);
    // selected=6 → newStart=2
    start = edgeScrollWindowStart(start, 6, visibleRows, total);
    expect(start).toBe(2);
  });

  it("sets start = selected when selection moves above the top edge", () => {
    // prevStart=5, window shows [5..9], selected=3 (above top) → newStart=3
    expect(edgeScrollWindowStart(5, 3, visibleRows, total)).toBe(3);
  });

  it("clamps start at 0 when selected is 0", () => {
    expect(edgeScrollWindowStart(0, 0, visibleRows, total)).toBe(0);
    // Wrap from last to first (modulo navigation)
    expect(edgeScrollWindowStart(5, 0, visibleRows, total)).toBe(0);
  });

  it("clamps start at max (total - visibleRows) when selected is at the last item", () => {
    // total=10, visibleRows=5, max start=5
    expect(edgeScrollWindowStart(4, 9, visibleRows, total)).toBe(5);
  });

  it("returns 0 when total <= visibleRows", () => {
    expect(edgeScrollWindowStart(0, 2, 10, 5)).toBe(0);
    expect(edgeScrollWindowStart(3, 4, 10, 8)).toBe(0);
    expect(edgeScrollWindowStart(0, 0, 5, 5)).toBe(0);
  });

  it("handles a jump (wrap from last to first via modulo) by re-anchoring to 0", () => {
    // User was at last item (selected=9, start=5), then wraps to selected=0
    expect(edgeScrollWindowStart(5, 0, visibleRows, total)).toBe(0);
  });

  it("handles a jump from first to last (wrap down)", () => {
    // User was at first item (selected=0, start=0), then wraps to selected=9
    // selected=9 >= start(0) + visibleRows(5)=5 → newStart = 9 - 5 + 1 = 5 (clamped to max 5)
    expect(edgeScrollWindowStart(0, 9, visibleRows, total)).toBe(5);
  });

  it("is a no-op when start is already valid and selection is at top edge", () => {
    // prevStart=3, window [3..7], selected=3 (top edge, inside) → stay at 3
    expect(edgeScrollWindowStart(3, 3, visibleRows, total)).toBe(3);
  });

  it("is a no-op when start is already valid and selection is at bottom edge", () => {
    // prevStart=3, window [3..7], selected=7 (bottom edge, inside) → stay at 3
    expect(edgeScrollWindowStart(3, 7, visibleRows, total)).toBe(3);
  });

  it("clamps an out-of-range prevStart before logic runs", () => {
    // prevStart=8 is out of range (max=5), should be clamped first, then logic applied
    // clamped prevStart=5, window [5..9], selected=4 (above) → newStart=4
    expect(edgeScrollWindowStart(8, 4, visibleRows, total)).toBe(4);
  });

  it("handles single-item list", () => {
    expect(edgeScrollWindowStart(0, 0, 5, 1)).toBe(0);
  });

  it("handles empty list (total=0)", () => {
    expect(edgeScrollWindowStart(0, 0, 5, 0)).toBe(0);
  });
});
