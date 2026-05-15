import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const { execSync } = await import("node:child_process");
const { parseGitCommits, getCommitDetail } = await import(
  "../../src/data/gitCommits.js"
);

const DAY = new Date(2026, 4, 14); // local midnight May 14

afterEach(() => vi.clearAllMocks());

describe("parseGitCommits", () => {
  it("returns empty array when git log output is empty", () => {
    vi.mocked(execSync).mockReturnValue("");
    const result = parseGitCommits("/some/project", DAY);
    expect(result).toHaveLength(0);
  });

  it("parses git log into ActivityEntry objects", () => {
    const ts = Math.floor(new Date(2026, 4, 14, 10, 30).getTime() / 1000);
    vi.mocked(execSync).mockReturnValue(
      `${ts}|abc1234|feat: add report command\n`,
    );

    const result = parseGitCommits("/some/project", DAY);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("commit");
    expect(result[0].label).toBe("abc1234");
    expect(result[0].detail).toBe("feat: add report command");
    expect(result[0].timestamp).toEqual(new Date(ts * 1000));
  });

  it("parses multiple commits and sorts by timestamp", () => {
    const ts1 = Math.floor(new Date(2026, 4, 14, 9, 0).getTime() / 1000);
    const ts2 = Math.floor(new Date(2026, 4, 14, 11, 0).getTime() / 1000);
    vi.mocked(execSync).mockReturnValue(
      `${ts2}|def5678|fix: timezone bug\n${ts1}|abc1234|feat: add command\n`,
    );

    const result = parseGitCommits("/some/project", DAY);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("abc1234"); // earlier first
    expect(result[1].label).toBe("def5678");
  });

  it("returns empty array when not a git repo", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not a git repo");
    });
    const result = parseGitCommits("/not/a/repo", DAY);
    expect(result).toHaveLength(0);
  });

  it("filters commits to the given date when no endDate", () => {
    vi.mocked(execSync).mockReturnValue("");
    parseGitCommits("/some/project", DAY);
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain("2026-05-14 00:00:00");
    expect(cmd).toContain("2026-05-14 23:59:59");
  });

  it("uses endDate for --before when provided", () => {
    vi.mocked(execSync).mockReturnValue("");
    const endDay = new Date(2026, 4, 16); // May 16
    parseGitCommits("/some/project", DAY, endDay);
    const cmd = vi.mocked(execSync).mock.calls[0][0] as string;
    expect(cmd).toContain("2026-05-14 00:00:00");
    expect(cmd).toContain("2026-05-16 23:59:59");
  });

  it("skips malformed lines", () => {
    const ts = Math.floor(new Date(2026, 4, 14, 10, 0).getTime() / 1000);
    vi.mocked(execSync).mockReturnValue(
      `bad-line\n${ts}|abc1234|valid commit\n`,
    );
    const result = parseGitCommits("/some/project", DAY);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("abc1234");
  });
});

describe("getCommitDetail", () => {
  it("returns git show --stat output", () => {
    const statOutput =
      "feat: add report\n\n src/cli.ts | 8 ++\n 1 file changed, 8 insertions(+)";
    vi.mocked(execSync).mockReturnValue(statOutput);

    const result = getCommitDetail("/some/project", "abc1234");
    expect(result).toBe(statOutput);
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining("git show --stat"),
      expect.objectContaining({ cwd: "/some/project" }),
    );
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      expect.stringContaining("abc1234"),
      expect.anything(),
    );
  });

  it("returns null when git fails", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not a git repo");
    });
    const result = getCommitDetail("/not/a/repo", "abc1234");
    expect(result).toBeNull();
  });
});
