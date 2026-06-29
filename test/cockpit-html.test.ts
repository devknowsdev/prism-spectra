import assert from "node:assert/strict";
import { renderProjectCockpitHtml } from "../tools/cockpit/projectCockpit.js";

function run() {
  const html = renderProjectCockpitHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

  assert.equal(scripts.length, 1, "cockpit page should render exactly one inline script");

  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script), "cockpit inline script should parse as JavaScript");
  }

  assert.match(html, /join\('\\\\n'\)/, "cockpit logs should join with an escaped newline literal");
  assert.doesNotMatch(html, /join\('\n'\)/, "cockpit logs must not render a literal line break inside a string");

  console.log("cockpit html test passed");
}

run();
