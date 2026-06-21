import { describe, expect, it } from "vitest";
import type { SearchState } from "../../../src/ui/search/searchKey.js";
import { applyDetailSearchKey } from "../../../src/ui/search/searchKey.js";

/** Convenience builder for an uncommitted detail search state. */
function uncommitted(query: string, index = 0): SearchState {
  return { surface: "detail", query, index, committed: false };
}

/** Convenience builder for a committed detail search state. */
function committed(query: string, index = 0): SearchState {
  return { surface: "detail", query, index, committed: true };
}

describe("applyDetailSearchKey — detail surface", () => {
  // ── Typing phase (uncommitted) ────────────────────────────────────────
  it("appends printable chars while uncommitted", () => {
    const s = uncommitted("");
    const r = applyDetailSearchKey(s, "f", {});
    expect(r).toMatchObject({ query: "f", committed: false });
  });

  it("appends 'n' while uncommitted (n is NOT treated as next)", () => {
    const s = uncommitted("f");
    const r = applyDetailSearchKey(s, "n", {});
    expect(r).toMatchObject({ query: "fn", committed: false });
  });

  it("appends 'N' while uncommitted (N is NOT treated as prev)", () => {
    const s = uncommitted("fu");
    const r = applyDetailSearchKey(s, "N", {});
    expect(r).toMatchObject({ query: "fuN", committed: false });
  });

  it("typing resets index to 0 (jump to first match)", () => {
    const s = uncommitted("fn", 3);
    const r = applyDetailSearchKey(s, "c", {});
    expect(r).toMatchObject({ query: "fnc", index: 0, committed: false });
  });

  it("backspace removes last char and stays uncommitted", () => {
    const s = uncommitted("fn");
    const r = applyDetailSearchKey(s, "", { backspace: true });
    expect(r).toMatchObject({ query: "f", committed: false });
  });

  it("delete key also removes last char", () => {
    const s = uncommitted("fn");
    const r = applyDetailSearchKey(s, "", { delete: true });
    expect(r).toMatchObject({ query: "f", committed: false });
  });

  it("backspace on empty query keeps empty and stays uncommitted", () => {
    const s = uncommitted("");
    const r = applyDetailSearchKey(s, "", { backspace: true });
    expect(r).toMatchObject({ query: "", committed: false });
  });

  it("Return commits (sets committed true, keeps query and index)", () => {
    const s = uncommitted("fn", 2);
    const r = applyDetailSearchKey(s, "", { return: true });
    expect(r).toMatchObject({ query: "fn", index: 2, committed: true });
  });

  // ── Committed phase ───────────────────────────────────────────────────
  it("after commit 'n' advances index (next match)", () => {
    const s = committed("fn", 0);
    const r = applyDetailSearchKey(s, "n", {});
    expect(r).toMatchObject({ index: 1, committed: true, query: "fn" });
  });

  it("after commit 'N' decrements index (prev match)", () => {
    const s = committed("fn", 2);
    const r = applyDetailSearchKey(s, "N", {});
    expect(r).toMatchObject({ index: 1, committed: true, query: "fn" });
  });

  it("after commit a printable char appends and un-commits", () => {
    const s = committed("fn", 3);
    const r = applyDetailSearchKey(s, "c", {});
    expect(r).toMatchObject({ query: "fnc", committed: false, index: 0 });
  });

  it("after commit backspace edits query and un-commits", () => {
    const s = committed("fn", 3);
    const r = applyDetailSearchKey(s, "", { backspace: true });
    expect(r).toMatchObject({ query: "f", committed: false });
  });

  it("after commit Return is a no-op (already committed)", () => {
    const s = committed("fn", 1);
    const r = applyDetailSearchKey(s, "", { return: true });
    expect(r).toMatchObject({ query: "fn", index: 1, committed: true });
  });

  // ── Escape exits search (returns null) ────────────────────────────────
  it("Esc while uncommitted → null (exit search)", () => {
    const s = uncommitted("fn");
    const r = applyDetailSearchKey(s, "", { escape: true });
    expect(r).toBeNull();
  });

  it("Esc while committed → null (exit search)", () => {
    const s = committed("fn", 2);
    const r = applyDetailSearchKey(s, "", { escape: true });
    expect(r).toBeNull();
  });

  // ── Ctrl-key combos are ignored ───────────────────────────────────────
  it("ctrl-char is ignored (no mutation)", () => {
    const s = uncommitted("fn");
    const r = applyDetailSearchKey(s, "c", { ctrl: true });
    expect(r).toEqual(s);
  });
});
