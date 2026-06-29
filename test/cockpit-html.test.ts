import assert from "node:assert/strict";
import { deriveCockpitGuidance, parsePidOutput, renderProjectCockpitHtml } from "../tools/cockpit/projectCockpit.js";

function mockProfile(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    name: "Focus ↔ Spectra Bridge",
    generatedAt: new Date().toISOString(),
    gateway: {
      host: "127.0.0.1",
      port: 3000,
      mode: "mock",
      mockExecutors: true,
      dbPath: "",
      workDir: "",
    },
    roles: [
      {
        id: "spectra-gateway-current",
        label: "Spectra Gateway",
        group: "Core runtime",
        kind: "virtual",
        status: { healthOk: true, running: false, externalPortOwner: false },
      },
      {
        id: "focus-ui",
        label: "Focus UI",
        group: "Core runtime",
        kind: "managed-process",
        commandPreview: "python3 -m http.server 4173",
        status: { running: false, externalPortOwner: false, lastExitCode: null },
      },
      {
        id: "spectra-validation",
        label: "Spectra Validation",
        group: "Validation",
        kind: "one-shot",
        commandPreview: "npm run typecheck && npm run test:ai-request && npm run test:cockpit",
        status: { running: false, lastExitCode: null },
      },
    ],
    ...overrides,
  } as any;
}

function run() {
  assert.deepEqual(parsePidOutput(""), [], "empty output → no pids");
  assert.deepEqual(parsePidOutput("  \n  "), [], "whitespace → no pids");
  assert.deepEqual(parsePidOutput("12345"), [12345], "single pid");
  assert.deepEqual(parsePidOutput("12345\n67890"), [12345, 67890], "multiple pids");
  assert.deepEqual(parsePidOutput("0"), [], "zero filtered");
  assert.deepEqual(parsePidOutput("-1"), [], "negative filtered");

  const g1 = deriveCockpitGuidance(mockProfile());
  assert.equal(g1.nextAction?.action, "start-role");
  assert.equal(g1.nextAction?.role, "focus-ui");
  assert.equal(g1.checklist.find(c => c.id === "gateway")?.status, "done");
  assert.equal(g1.checklist.find(c => c.id === "focus")?.status, "pending");

  const g2 = deriveCockpitGuidance(mockProfile({
    roles: mockProfile().roles.map((role: any) => role.id === "focus-ui"
      ? { ...role, status: { running: false, externalPortOwner: true } }
      : role),
  }));
  assert.equal(g2.nextAction?.action, "acknowledge-external");
  assert.equal(g2.checklist.find(c => c.id === "focus")?.status, "warn");

  const g3 = deriveCockpitGuidance(mockProfile({
    roles: mockProfile().roles.map((role: any) => role.id === "focus-ui"
      ? { ...role, status: { running: true, externalPortOwner: false } }
      : role),
  }));
  assert.equal(g3.nextAction?.action, "run-one-shot");
  assert.equal(g3.nextAction?.role, "spectra-validation");

  const g4 = deriveCockpitGuidance(mockProfile({
    roles: mockProfile().roles.map((role: any) => {
      if (role.id === "focus-ui") return { ...role, status: { running: true, externalPortOwner: false } };
      if (role.id === "spectra-validation") return { ...role, status: { running: false, lastExitCode: 0 } };
      return role;
    }),
  }));
  assert.equal(g4.nextAction?.action, "open-linked-app");
  assert.equal(g4.checklist.find(c => c.id === "validation")?.status, "done");
  assert.equal(g4.checklist.find(c => c.id === "bridge")?.status, "pending");

  const g5 = deriveCockpitGuidance(mockProfile({
    roles: mockProfile().roles.map((role: any) => {
      if (role.id === "focus-ui") return { ...role, status: { running: true, externalPortOwner: false } };
      if (role.id === "spectra-validation") return { ...role, status: { running: false, lastExitCode: 1 } };
      return role;
    }),
  }));
  assert.equal(g5.nextAction?.action, "show-logs");
  assert.equal(g5.nextAction?.role, "spectra-validation");
  assert.equal(g5.nextAction?.requiresApproval, false);

  const html = renderProjectCockpitHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

  assert.equal(scripts.length, 1, "cockpit page should render exactly one inline script");

  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script), "cockpit inline script should parse as JavaScript");
  }

  assert.match(html, /guided-panel/, "cockpit should render the guided panel scaffold");
  assert.match(html, /advanced-section/, "cockpit should keep advanced process controls behind a section");
  assert.match(html, /data-guided-action/, "guided approve buttons should use structured action packets");
  assert.match(html, /Open validation logs/, "failed validation guidance should expose a direct log button");
  assert.match(html, /let advancedOpen = false/, "advanced drawer state should survive auto-refresh renders");
  assert.match(html, /openLogRoles/, "open log cards should survive auto-refresh renders");
  assert.match(html, /join\('\\\\n'\)/, "cockpit logs should join with an escaped newline literal");
  assert.doesNotMatch(html, /join\('\n'\)/, "cockpit logs must not render a literal line break inside a string");
  assert.doesNotMatch(html, /external pid\(s\).*status\.port\.pids\.join/, "external pid display should filter real positive PIDs before rendering");

  console.log("cockpit html test passed");
}

run();
