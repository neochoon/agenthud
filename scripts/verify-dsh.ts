/** Manual verification against the REAL DSH corpus (not part of the suite). */

import { dshProvider } from "../src/data/providers/dsh.js";
import { parseSessionHistory } from "../src/data/sessionHistory.js";
import { discoverSessions } from "../src/data/sessions.js";

const config = {
  refreshIntervalMs: 2000,
  hiddenSessions: [],
  hiddenSubAgents: [],
  filterPresets: [[]],
  hiddenProjects: [],
  report: {
    include: [],
    detailLimit: 0,
    withGit: false,
    format: "markdown" as const,
  },
  summary: {},
};

console.log("DSH_HOME:", process.env.DSH_HOME);
console.log("isAvailable:", dshProvider.isAvailable());

const t0 = Date.now();
const tree = discoverSessions(config);
const dshProjects = [...tree.projects, ...tree.coldProjects].filter((p) =>
  p.sessions.some((s) => s.provider === "dsh"),
);
const ms = Date.now() - t0;
const dshSessions = dshProjects.flatMap((p) =>
  p.sessions.filter((s) => s.provider === "dsh"),
);
const subs = dshSessions.reduce((n, s) => n + s.subAgents.length, 0);
console.log(
  `\nfull tree in ${ms}ms — dsh projects: ${dshProjects.length}, sessions: ${dshSessions.length}, sub-agents: ${subs}`,
);

console.log("\ntop 8 by recency:");
for (const s of [...dshSessions]
  .sort((a, b) => b.lastModifiedMs - a.lastModifiedMs)
  .slice(0, 8)) {
  console.log(
    [
      s.id.slice(0, 22).padEnd(24),
      s.status.padEnd(5),
      `live=${String(s.liveState).padEnd(8)}`,
      `ctx=${s.contextUsage ? `${s.contextUsage.percent}%` : "-"}`.padEnd(8),
      `subs=${s.subAgents.length}`.padEnd(7),
      `ver=${s.version}`.padEnd(6),
      `model=${s.modelName ?? "-"}`.padEnd(28),
      (s.firstUserPrompt ?? "").slice(0, 40),
    ].join(" "),
  );
}

const live = [...dshSessions].sort(
  (a, b) => b.lastModifiedMs - a.lastModifiedMs,
)[0];
console.log(`\nhistory of newest session (${live.id}):`);
const acts = parseSessionHistory(live.filePath);
console.log(`activities: ${acts.length}`);
for (const a of acts.slice(-14)) {
  const body = a.detailBody
    ? ` [body ${a.detailBody.length}b${a.detailNumbered ? " numbered" : ""}]`
    : "";
  console.log(
    `  ${a.timestamp.toISOString().slice(11, 19)} ${a.icon} ${a.label}: ${a.detail.slice(0, 70)}${body}`,
  );
}

// Timing: second discover is the cached path.
const t1 = Date.now();
discoverSessions(config);
console.log(`\nsecond discover (warm caches): ${Date.now() - t1}ms`);
