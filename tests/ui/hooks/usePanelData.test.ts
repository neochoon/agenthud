/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelData } from "../../../src/ui/hooks/usePanelData.js";

describe("usePanelData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("calls fetcher on initialization and sets data", () => {
      const fetcher = vi.fn().mockReturnValue({ branch: "main" });

      const { result } = renderHook(() =>
        usePanelData({
          fetcher,
        }),
      );

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.current.data).toEqual({ branch: "main" });
    });

    it("passes dependencies to fetcher", () => {
      const fetcher = vi.fn().mockReturnValue({ value: 42 });

      renderHook(() =>
        usePanelData({
          fetcher,
          deps: ["arg1", 123],
        }),
      );

      expect(fetcher).toHaveBeenCalledWith("arg1", 123);
    });

    it("handles fetcher that returns null", () => {
      const fetcher = vi.fn().mockReturnValue(null);

      const { result } = renderHook(() =>
        usePanelData({
          fetcher,
        }),
      );

      expect(result.current.data).toBeNull();
    });
  });

  describe("refresh", () => {
    it("updates data when refresh is called", () => {
      let counter = 0;
      const fetcher = vi.fn().mockImplementation(() => ({ count: counter++ }));

      const { result } = renderHook(() =>
        usePanelData({
          fetcher,
        }),
      );

      expect(result.current.data).toEqual({ count: 0 });

      act(() => {
        result.current.refresh();
      });

      expect(result.current.data).toEqual({ count: 1 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("passes dependencies on refresh", () => {
      const fetcher = vi.fn().mockReturnValue({ value: 1 });

      const { result } = renderHook(() =>
        usePanelData({
          fetcher,
          deps: ["dep1", "dep2"],
        }),
      );

      act(() => {
        result.current.refresh();
      });

      expect(fetcher).toHaveBeenLastCalledWith("dep1", "dep2");
    });
  });

  describe("refreshAsync", () => {
    it("updates data asynchronously", async () => {
      vi.useRealTimers(); // Need real timers for async

      let counter = 0;
      const asyncFetcher = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { count: counter++ };
      });

      const { result } = renderHook(() =>
        usePanelData({
          fetcher: () => ({ count: -1 }), // sync initial
          asyncFetcher,
        }),
      );

      expect(result.current.data).toEqual({ count: -1 });

      await act(async () => {
        await result.current.refreshAsync();
      });

      expect(result.current.data).toEqual({ count: 0 });
      expect(asyncFetcher).toHaveBeenCalledTimes(1);
    });

    it("passes dependencies to asyncFetcher", async () => {
      vi.useRealTimers();

      const asyncFetcher = vi.fn().mockResolvedValue({ value: 1 });

      const { result } = renderHook(() =>
        usePanelData({
          fetcher: () => null,
          asyncFetcher,
          deps: ["async1", "async2"],
        }),
      );

      await act(async () => {
        await result.current.refreshAsync();
      });

      expect(asyncFetcher).toHaveBeenCalledWith("async1", "async2");
    });

    it("falls back to sync fetcher if asyncFetcher not provided", async () => {
      vi.useRealTimers();

      let counter = 0;
      const fetcher = vi.fn().mockImplementation(() => ({ count: counter++ }));

      const { result } = renderHook(() =>
        usePanelData({
          fetcher,
        }),
      );

      expect(result.current.data).toEqual({ count: 0 });

      await act(async () => {
        await result.current.refreshAsync();
      });

      expect(result.current.data).toEqual({ count: 1 });
    });
  });

  describe("enabled option", () => {
    it("does not call fetcher when enabled is false", () => {
      const fetcher = vi.fn().mockReturnValue({ value: 1 });

      const { result } = renderHook(() =>
        usePanelData({
          fetcher,
          enabled: false,
        }),
      );

      expect(fetcher).not.toHaveBeenCalled();
      expect(result.current.data).toBeNull();
    });

    it("calls fetcher when enabled changes to true", () => {
      const fetcher = vi.fn().mockReturnValue({ value: 1 });

      const { result, rerender } = renderHook(
        ({ enabled }) =>
          usePanelData({
            fetcher,
            enabled,
          }),
        { initialProps: { enabled: false } },
      );

      expect(fetcher).not.toHaveBeenCalled();
      expect(result.current.data).toBeNull();

      rerender({ enabled: true });

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.current.data).toEqual({ value: 1 });
    });
  });

  describe("dependencies change", () => {
    it("refetches when deps change", () => {
      const fetcher = vi.fn().mockImplementation((id: string) => ({ id }));

      const { result, rerender } = renderHook(
        ({ id }) =>
          usePanelData({
            fetcher,
            deps: [id],
          }),
        { initialProps: { id: "first" } },
      );

      expect(result.current.data).toEqual({ id: "first" });
      expect(fetcher).toHaveBeenCalledTimes(1);

      rerender({ id: "second" });

      expect(result.current.data).toEqual({ id: "second" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("catches sync fetcher errors and sets error state", () => {
      const fetcher = vi.fn().mockImplementation(() => {
        throw new Error("Fetch failed");
      });

      const { result } = renderHook(() =>
        usePanelData({
          fetcher,
        }),
      );

      expect(result.current.data).toBeNull();
      expect(result.current.error).toBe("Fetch failed");
    });

    it("catches async fetcher errors and sets error state", async () => {
      vi.useRealTimers();

      const asyncFetcher = vi.fn().mockRejectedValue(new Error("Async failed"));

      const { result } = renderHook(() =>
        usePanelData({
          fetcher: () => null,
          asyncFetcher,
        }),
      );

      await act(async () => {
        await result.current.refreshAsync();
      });

      expect(result.current.error).toBe("Async failed");
    });

    it("clears error on successful fetch", async () => {
      vi.useRealTimers();

      let shouldFail = true;
      const asyncFetcher = vi.fn().mockImplementation(async () => {
        if (shouldFail) {
          throw new Error("Failed");
        }
        return { success: true };
      });

      const { result } = renderHook(() =>
        usePanelData({
          fetcher: () => null,
          asyncFetcher,
        }),
      );

      await act(async () => {
        await result.current.refreshAsync();
      });

      expect(result.current.error).toBe("Failed");

      shouldFail = false;

      await act(async () => {
        await result.current.refreshAsync();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.data).toEqual({ success: true });
    });
  });

  describe("isLoading state", () => {
    it("sets isLoading during async fetch", async () => {
      vi.useRealTimers();

      let resolvePromise: (value: unknown) => void;
      const asyncFetcher = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve;
          }),
      );

      const { result } = renderHook(() =>
        usePanelData({
          fetcher: () => null,
          asyncFetcher,
        }),
      );

      expect(result.current.isLoading).toBe(false);

      let refreshPromise: Promise<void>;
      act(() => {
        refreshPromise = result.current.refreshAsync();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      await act(async () => {
        resolvePromise?.({ done: true });
        await refreshPromise;
      });

      expect(result.current.isLoading).toBe(false);
    });
  });
});
