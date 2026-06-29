import assert from "node:assert/strict";
import { parsePidOutput, renderProjectCockpitHtml } from "../tools/cockpit/projectCockpit.js";

function run() {
  assert.deepEqual(parsePidOutput(""), [], "empty output → no pids");
  assert.deepEqual(parsePidOutput("  \n  "), [], "whitespace → no pids");
  assert.deepEqual(parsePidOutput("12345"), [12345], "single pid");
  assert.deepEqual(parsePidOutput("12345\n67890"), [12345, 67890], "multiple pids");
  assert.deepEqual(parsePidOutput("0"), [], "zero filtered");
  assert.deepEqual(parsePidOutput("-1"), [], "negative filtered");

  const html = renderProjectCockpitHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

  assert.equal(scripts.length, 1, "cockpit page should render exactly one inline script");

  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script), "cockpit inline script should parse as JavaScript");
  }

  assert.match(html, /join\('\\n'\)/, "cockpit logs should join with an escaped newline literal");
  assert.doesNotMatch(html, /join\('\n'\)/, "cockpit logs must not render a literal line break inside a string");
  assert.doesNotMatch(html, /external pid\(s\).*status\.port\.pids\.join/, "external pid display should filter real positive PIDs before rendering");

  console.log("cockpit html test passed");
}

run();
