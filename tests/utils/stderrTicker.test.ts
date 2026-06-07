import { describe, expect, it } from "vitest";
import { formatTickerLine } from "../../src/utils/stderrTicker.js";

describe("formatTickerLine", () => {
  it("renders zero dots padded to 3 chars so the suffix doesn't jitter", () => {
    // No dots → 3 spaces of padding so "0s" sits in the same column
    // whether dots is 0, 1, 2, or 3.
    expect(formatTickerLine("sending to claude", 0, 0)).toBe(
      "sending to claude    0s",
    );
  });

  it("renders one dot and pads with two spaces", () => {
    expect(formatTickerLine("sending to claude", 1, 1)).toBe(
      "sending to claude.   1s",
    );
  });

  it("renders three dots with no padding", () => {
    expect(formatTickerLine("sending to claude", 3, 3)).toBe(
      "sending to claude... 3s",
    );
  });

  it("wraps the dot count at 4 so the cycle is 0,1,2,3,0,1,...", () => {
    expect(formatTickerLine("x", 4, 4)).toBe("x    4s"); // 4 % 4 === 0 dots
    expect(formatTickerLine("x", 5, 5)).toBe("x.   5s"); // 5 % 4 === 1 dot
  });

  it("accepts arbitrary labels and elapsed values", () => {
    expect(formatTickerLine("waiting", 47, 9)).toBe("waiting.   47s");
  });
});
