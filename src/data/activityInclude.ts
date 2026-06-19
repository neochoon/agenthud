import type { ActivityEntry } from "../types/index.js";

/**
 * Whether an activity matches an `--include` type filter. Shared by
 * `report` (`reportGenerator`) and `follow` (`followStream`) so the two
 * never drift — notably `read` deliberately also matches `glob`/`grep`.
 */
export function activityMatchesInclude(
  activity: ActivityEntry,
  include: readonly string[],
): boolean {
  const label = activity.label.toLowerCase();
  const type = activity.type;
  if (include.includes("response") && type === "response") return true;
  if (include.includes("thinking") && type === "thinking") return true;
  if (include.includes("user") && type === "user") return true;
  if (include.includes("bash") && label === "bash") return true;
  if (
    include.includes("edit") &&
    (label === "edit" || label === "write" || label === "todowrite")
  )
    return true;
  if (
    include.includes("read") &&
    (label === "read" || label === "glob" || label === "grep")
  )
    return true;
  if (include.includes("glob") && (label === "glob" || label === "grep"))
    return true;
  if (include.includes("task") && label === "task") return true;
  return false;
}
