import { describe, expect, it } from "vitest";
import {
  isNodeVersionSupported,
  parseNodeMajorVersion,
} from "../../src/utils/nodeVersion.js";

describe("nodeVersion", () => {
  describe("parseNodeMajorVersion", () => {
    it("should parse major version from v20.10.0", () => {
      expect(parseNodeMajorVersion("v20.10.0")).toBe(20);
    });

    it("should parse major version from v18.17.0", () => {
      expect(parseNodeMajorVersion("v18.17.0")).toBe(18);
    });

    it("should parse major version from v22.0.0", () => {
      expect(parseNodeMajorVersion("v22.0.0")).toBe(22);
    });
  });

  describe("isNodeVersionSupported", () => {
    it("should return true for Node 20", () => {
      expect(isNodeVersionSupported(20)).toBe(true);
    });

    it("should return true for Node 22", () => {
      expect(isNodeVersionSupported(22)).toBe(true);
    });

    it("should return false for Node 18", () => {
      expect(isNodeVersionSupported(18)).toBe(false);
    });

    it("should return false for Node 19", () => {
      expect(isNodeVersionSupported(19)).toBe(false);
    });
  });
});
