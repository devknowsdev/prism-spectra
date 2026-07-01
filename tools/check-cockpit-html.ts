#!/usr/bin/env -S tsx

import { renderProjectCockpitHtml } from "./cockpit/projectCockpit.js";

const html = renderProjectCockpitHtml();
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

if (scripts.length !== 1) {
  throw new Error(`Expected exactly one cockpit inline script, found ${scripts.length}`);
}

for (const script of scripts) {
  new Function(script);
}

if (!html.includes("join('\\\\n')")) {
  throw new Error("Expected cockpit logs to join with an escaped newline literal");
}

if (/join\('\n'\)/.test(html)) {
  throw new Error("Cockpit logs rendered a literal line break inside a string");
}

console.log("cockpit html check passed");
