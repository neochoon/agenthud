#!/usr/bin/env node
// Compare two heap snapshots and show which object types grew the most.

import { readFileSync } from "node:fs";

const earlyPath = process.argv[2] ?? "/tmp/agenthud-early.heapsnapshot";
const latePath = process.argv[3] ?? "/tmp/agenthud-late.heapsnapshot";

interface Snapshot {
  snapshot: {
    node_count: number;
    meta: {
      node_fields: string[];
      node_types: (string | string[])[];
    };
  };
  nodes: number[];
  strings: string[];
}

function countByType(path: string): Map<string, { count: number; size: number }> {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Snapshot;
  const fields = raw.snapshot.meta.node_fields;
  const typeEnum = raw.snapshot.meta.node_types[fields.indexOf("type")] as string[];
  const fieldCount = fields.length;
  const nameIdx = fields.indexOf("name");
  const typeIdx = fields.indexOf("type");
  const sizeIdx = fields.indexOf("self_size");

  const counts = new Map<string, { count: number; size: number }>();
  for (let i = 0; i < raw.nodes.length; i += fieldCount) {
    const type = typeEnum[raw.nodes[i + typeIdx]];
    const name = raw.strings[raw.nodes[i + nameIdx]];
    const size = raw.nodes[i + sizeIdx];
    const key = `${type}|${name}`;
    const entry = counts.get(key) ?? { count: 0, size: 0 };
    entry.count++;
    entry.size += size;
    counts.set(key, entry);
  }
  return counts;
}

const early = countByType(earlyPath);
const late = countByType(latePath);

interface Diff {
  key: string;
  earlyCount: number;
  lateCount: number;
  countDelta: number;
  sizeDelta: number;
}
const diffs: Diff[] = [];

for (const [key, lateVal] of late) {
  const earlyVal = early.get(key) ?? { count: 0, size: 0 };
  diffs.push({
    key,
    earlyCount: earlyVal.count,
    lateCount: lateVal.count,
    countDelta: lateVal.count - earlyVal.count,
    sizeDelta: lateVal.size - earlyVal.size,
  });
}

diffs.sort((a, b) => b.sizeDelta - a.sizeDelta);
console.log("Top growers by total size delta:");
console.log("size_delta_kb\tcount_delta\tearly\tlate\ttype|name");
for (const d of diffs.slice(0, 40)) {
  console.log(
    `${(d.sizeDelta / 1024).toFixed(0).padStart(8)}\t${d.countDelta.toString().padStart(8)}\t${d.earlyCount.toString().padStart(5)}\t${d.lateCount.toString().padStart(5)}\t${d.key}`,
  );
}
