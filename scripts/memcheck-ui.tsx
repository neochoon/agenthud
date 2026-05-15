#!/usr/bin/env node
// Render App with ink-testing-library and watch memory while time passes.
// Spinner re-renders every 100ms, so this simulates the watch loop.

import { writeHeapSnapshot } from "node:v8";
import { render } from "ink-testing-library";
import React from "react";
import { App } from "../src/ui/App.js";

const seconds = Number(process.argv[2] ?? 60);
const mb = (b: number) => (b / 1024 / 1024).toFixed(1);

const printMem = (label: string) => {
  const m = process.memoryUsage();
  console.log(
    `${label.padEnd(20)} rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB ext=${mb(m.external)}MB`,
  );
};

printMem("start");

const instance = render(React.createElement(App, { mode: "watch" }));

printMem("after render");

const interval = setInterval(() => {
  if (global.gc) global.gc();
  printMem(`t=${process.uptime().toFixed(0)}s`);
}, 5_000);

// Snapshot at start (after warm-up) and end so we can diff
setTimeout(() => {
  if (global.gc) global.gc();
  const p = writeHeapSnapshot("/tmp/agenthud-early.heapsnapshot");
  console.log(`early snapshot: ${p}`);
}, 5_000);

setTimeout(() => {
  clearInterval(interval);
  if (global.gc) global.gc();
  const p = writeHeapSnapshot("/tmp/agenthud-late.heapsnapshot");
  console.log(`late snapshot: ${p}`);
  instance.unmount();
  if (global.gc) global.gc();
  printMem("end");
  process.exit(0);
}, seconds * 1000);
