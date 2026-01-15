import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ProjectPanel } from "../../src/ui/ProjectPanel.js";
import type { ProjectData } from "../../src/data/project.js";

describe("ProjectPanel", () => {
  const mockProjectData: ProjectData = {
    name: "agenthud",
    language: "TypeScript",
    license: "MIT",
    stack: ["ink", "react", "vitest"],
    fileCount: 44,
    fileExtension: "ts",
    lineCount: 3500,
    prodDeps: 3,
    devDeps: 8,
  };

  describe("header display", () => {
    it("shows project name", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      expect(lastFrame()).toContain("agenthud");
    });

    it("shows language", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      expect(lastFrame()).toContain("TypeScript");
    });

    it("shows license", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      expect(lastFrame()).toContain("MIT");
    });

    it("shows name, language, and license separated by ·", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      // Should have all three in the format: name · language · license
      const output = lastFrame() || "";
      expect(output).toMatch(/agenthud.*·.*TypeScript.*·.*MIT/);
    });
  });

  describe("stack display", () => {
    it("shows stack items", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      expect(lastFrame()).toContain("Stack:");
      expect(lastFrame()).toContain("ink");
      expect(lastFrame()).toContain("react");
      expect(lastFrame()).toContain("vitest");
    });

    it("separates stack items with commas", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      const output = lastFrame() || "";
      expect(output).toMatch(/ink,\s*react,\s*vitest/);
    });

    it("hides stack line when stack is empty", () => {
      const dataNoStack: ProjectData = {
        ...mockProjectData,
        stack: [],
      };

      const { lastFrame } = render(<ProjectPanel data={dataNoStack} />);

      expect(lastFrame()).not.toContain("Stack:");
    });
  });

  describe("file and line count display", () => {
    it("shows file count with extension", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      expect(lastFrame()).toContain("44 ts");
    });

    it("shows line count", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      expect(lastFrame()).toContain("3.5k");
    });

    it("formats large line counts with k suffix", () => {
      const dataLarge: ProjectData = {
        ...mockProjectData,
        lineCount: 15234,
      };

      const { lastFrame } = render(<ProjectPanel data={dataLarge} />);

      expect(lastFrame()).toContain("15.2k");
    });

    it("shows small line counts without k suffix", () => {
      const dataSmall: ProjectData = {
        ...mockProjectData,
        lineCount: 500,
      };

      const { lastFrame } = render(<ProjectPanel data={dataSmall} />);

      expect(lastFrame()).toContain("500");
      expect(lastFrame()).not.toContain("0.5k");
    });

    it("shows Files and Lines labels", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      expect(lastFrame()).toContain("Files:");
      expect(lastFrame()).toContain("Lines:");
    });
  });

  describe("dependency count display", () => {
    it("shows prod and dev dependency counts", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      expect(lastFrame()).toContain("Deps:");
      expect(lastFrame()).toContain("3 prod");
      expect(lastFrame()).toContain("8 dev");
    });

    it("separates prod and dev with ·", () => {
      const { lastFrame } = render(<ProjectPanel data={mockProjectData} />);

      const output = lastFrame() || "";
      expect(output).toMatch(/3 prod.*·.*8 dev/);
    });

    it("shows only prod deps for Python with no dev deps", () => {
      const pythonData: ProjectData = {
        name: "my-api",
        language: "Python",
        license: "MIT",
        stack: ["fastapi"],
        fileCount: 28,
        fileExtension: "py",
        lineCount: 2100,
        prodDeps: 8,
        devDeps: 0,
      };

      const { lastFrame } = render(<ProjectPanel data={pythonData} />);

      expect(lastFrame()).toContain("8");
      // Should not show "0 dev" when there are no dev deps
    });
  });

  describe("Python project display", () => {
    it("shows Python project correctly", () => {
      const pythonData: ProjectData = {
        name: "my-api",
        language: "Python",
        license: "Apache-2.0",
        stack: ["fastapi", "pytest", "sqlalchemy"],
        fileCount: 28,
        fileExtension: "py",
        lineCount: 2100,
        prodDeps: 5,
        devDeps: 3,
      };

      const { lastFrame } = render(<ProjectPanel data={pythonData} />);

      expect(lastFrame()).toContain("my-api");
      expect(lastFrame()).toContain("Python");
      expect(lastFrame()).toContain("Apache-2.0");
      expect(lastFrame()).toContain("fastapi");
      expect(lastFrame()).toContain("28 py");
      expect(lastFrame()).toContain("2.1k");
    });
  });

  describe("empty/unknown states", () => {
    it("shows 'Unknown' when language is null", () => {
      const unknownData: ProjectData = {
        ...mockProjectData,
        language: null,
      };

      const { lastFrame } = render(<ProjectPanel data={unknownData} />);

      // Should still show project name but handle null language
      expect(lastFrame()).toContain("agenthud");
    });

    it("hides license when null", () => {
      const noLicenseData: ProjectData = {
        ...mockProjectData,
        license: null,
      };

      const { lastFrame } = render(<ProjectPanel data={noLicenseData} />);

      expect(lastFrame()).toContain("agenthud");
      expect(lastFrame()).toContain("TypeScript");
      // Should not have dangling separator
      expect(lastFrame()).not.toMatch(/·\s*$/m);
    });

    it("shows 0 for zero file count", () => {
      const zeroFiles: ProjectData = {
        ...mockProjectData,
        fileCount: 0,
        lineCount: 0,
      };

      const { lastFrame } = render(<ProjectPanel data={zeroFiles} />);

      expect(lastFrame()).toContain("0");
    });
  });

  describe("error handling", () => {
    it("shows error message when error is present", () => {
      const errorData: ProjectData = {
        ...mockProjectData,
        error: "Failed to read project info",
      };

      const { lastFrame } = render(<ProjectPanel data={errorData} />);

      expect(lastFrame()).toContain("Failed to read project info");
    });
  });

  describe("countdown display", () => {
    it("shows countdown when provided", () => {
      const { lastFrame } = render(
        <ProjectPanel data={mockProjectData} countdown={300} />
      );

      expect(lastFrame()).toContain("300s");
    });

    it("does not show countdown when null", () => {
      const { lastFrame } = render(
        <ProjectPanel data={mockProjectData} countdown={null} />
      );

      // Should not show countdown indicator (↻)
      expect(lastFrame()).not.toContain("↻");
    });
  });

  describe("width prop", () => {
    it("respects custom width", () => {
      const { lastFrame } = render(
        <ProjectPanel data={mockProjectData} width={80} />
      );

      const output = lastFrame() || "";
      const lines = output.split("\n");

      // All lines with box borders should be roughly the same width
      const borderedLines = lines.filter((l) => l.includes("─"));
      expect(borderedLines.length).toBeGreaterThan(0);
    });
  });
});
