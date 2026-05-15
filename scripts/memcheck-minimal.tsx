#!/usr/bin/env node
// Minimal Ink test: only spinner-style re-renders, no other state.

import { Text } from "ink";
import { render } from "ink-testing-library";
import React, { useEffect, useState } from "react";

const seconds = Number(process.argv[2] ?? 60);
const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
const printMem = (label: string) => {
  const m = process.memoryUsage();
  console.log(
    `${label.padEnd(20)} rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB ext=${mb(m.external)}MB`,
  );
};

function App() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => v + 1), 100);
    return () => clearInterval(t);
  }, []);
  return React.createElement(Text, null, `tick ${i}`);
}

printMem("start");
const instance = render(React.createElement(App));
printMem("after render");

const iv = setInterval(() => {
  if (global.gc) global.gc();
  printMem(`t=${process.uptime().toFixed(0)}s`);
}, 5_000);

setTimeout(() => {
  clearInterval(iv);
  instance.unmount();
  if (global.gc) global.gc();
  printMem("end");
  process.exit(0);
}, seconds * 1000);
