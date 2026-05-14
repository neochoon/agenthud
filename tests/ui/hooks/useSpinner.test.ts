/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpinner } from "../../../src/ui/hooks/useSpinner.js";

describe("useSpinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns first frame initially when active", () => {
    const { result } = renderHook(() => useSpinner(true));
    expect(result.current).toBe("⠋");
  });

  it("returns empty string when inactive", () => {
    const { result } = renderHook(() => useSpinner(false));
    expect(result.current).toBe("");
  });

  it("advances frame after interval", () => {
    const { result } = renderHook(() => useSpinner(true, 100));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("⠙");
  });

  it("cycles back to first frame after all frames", () => {
    const { result } = renderHook(() => useSpinner(true, 100));
    act(() => {
      vi.advanceTimersByTime(1000); // 10 frames × 100ms
    });
    expect(result.current).toBe("⠋");
  });

  it("stops advancing when inactive", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useSpinner(active, 100),
      { initialProps: { active: true } },
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ active: false });
    const frameAtDeactivation = result.current;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe("");
    expect(frameAtDeactivation).toBe("");
  });
});
