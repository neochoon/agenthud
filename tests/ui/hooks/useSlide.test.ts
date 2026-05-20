/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSlide } from "../../../src/ui/hooks/useSlide.js";

describe("useSlide", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 initially when active", () => {
    const { result } = renderHook(() => useSlide(true, 8));
    expect(result.current).toBe(0);
  });

  it("returns 0 when inactive (no animation)", () => {
    const { result } = renderHook(() => useSlide(false, 8));
    expect(result.current).toBe(0);
  });

  it("advances position after the interval", () => {
    const { result } = renderHook(() => useSlide(true, 8, 100));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(1);
  });

  it("wraps back to 0 after `positions` ticks", () => {
    const { result } = renderHook(() => useSlide(true, 8, 100));
    act(() => {
      vi.advanceTimersByTime(800); // 8 ticks
    });
    expect(result.current).toBe(0);
  });

  it("stops advancing when active flips to false", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useSlide(active, 8, 100),
      { initialProps: { active: true } },
    );
    act(() => {
      vi.advanceTimersByTime(300); // index = 3
    });
    expect(result.current).toBe(3);
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(1000); // would be many more ticks if it were running
    });
    // Position stays where it was; no further advances.
    expect(result.current).toBe(3);
  });
});
