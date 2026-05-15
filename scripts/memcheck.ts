#!/usr/bin/env node
// Run data-layer loop and watch memory growth.
// Usage: tsx scripts/memcheck.ts [iterations]

import { loadGlobalConfig } from "../src/config/globalConfig.js";
import { parseGitCommits } from "../src/data/gitCommits.js";
import { parseSessionHistory } from "../src/data/sessionHistory.js";
import { discoverSessions } from "../src/data/sessions.js";

const iterations = Number(process.argv[2] ?? 1000);

const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
const printMem = (label: string) => {
  const m = process.memoryUsage();
  console.log(
    `${label.padEnd(20)} rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB ext=${mb(m.external)}MB`,
  );
};

const config = loadGlobalConfig();
printMem("start");

const tree = discoverSessions(config);
const session = tree.sessions[0];
if (!session) {
  console.error("No sessions found");
  process.exit(1);
}
console.log(`Using session: ${session.projectName}/${session.id}`);
console.log(`File: ${session.filePath}`);

printMem("after discover");

for (let i = 1; i <= iterations; i++) {
  // Simulate what refresh() + git effect do every cycle
  discoverSessions(config);
  parseSessionHistory(session.filePath);
  if (session.projectPath) {
    const today = new Date();
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    parseGitCommits(session.projectPath, day);
  }

  if (i % 100 === 0) {
    if (global.gc) global.gc();
    printMem(`iter ${i}`);
  }
}

if (global.gc) global.gc();
printMem("end");
