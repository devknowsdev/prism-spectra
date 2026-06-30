import assert from "node:assert/strict";
import { InMemoryApprovalQueue } from "../src/approvals/index.js";
import { InMemoryPrismEventLedger } from "../src/events/index.js";
import {
  deriveCockpitGuidance,
  handleApproveGuidedAction,
  parsePidOutput,
  renderProjectCockpitHtml,
} from "../tools/cockpit/projectCockpit.js";

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
  assert.equal(g1.nextAction?.approvalClass, "write");
  assert.equal(g1.nextAction?.checkpointPolicy, "before_write");
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
  assert.equal(g5.nextAction?.approvalClass, "observe");
  assert.equal(g5.nextAction?.checkpointPolicy, "none");
  assert.match(g5.nextAction?.reason ?? "", /Review the failed validation output below/);

  const ledger = new InMemoryPrismEventLedger();
  const approvalQueue = new InMemoryApprovalQueue(ledger);
  const writeResult = handleApproveGuidedAction(
    { approvalQueue },
    { nextAction: g1.nextAction }
  );
  assert.equal(writeResult.ok, true);
  assert.ok("approvalId" in writeResult);
  const approvals = approvalQueue.listApprovals();
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].status, "approved");
  assert.equal(approvals[0].title, "Start Focus UI");
  assert.equal(approvals[0].approvalClass, "write");
  assert.equal(approvals[0].checkpointPolicy, "before_write");
  assert.equal(approvals[0].cliEquivalent, "python3 -m http.server 4173");
  assert.equal(approvals[0].localRemoteBoundary, "local-only");
  assert.equal(approvals[0].requestedBy, "dave-cockpit");
  const approvalEvents = ledger.list();
  assert.equal(approvalEvents.length, 2);
  assert.deepEqual(
    new Set(approvalEvents.map(event => event.type)),
    new Set(["approval.requested", "approval.resolved"])
  );

  const observeResult = handleApproveGuidedAction(
    { approvalQueue },
    { nextAction: g5.nextAction }
  );
  assert.deepEqual(observeResult, { ok: true, approvalSkipped: true });
  assert.equal(approvalQueue.listApprovals().length, 1, "observe actions must not create approvals");

  const html = renderProjectCockpitHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

  assert.equal(scripts.length, 1, "cockpit page should render exactly one inline script");

  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script), "cockpit inline script should parse as JavaScript");
  }

  assert.match(html, /guided-panel/, "cockpit should render the guided panel scaffold");
  assert.match(html, /advanced-section/, "cockpit should keep advanced process controls behind a section");
  assert.match(html, /data-guided-action/, "guided approve buttons should use structured actions");
  assert.match(html, /\/api\/v1\/cockpit\/actions\/approve/, "write actions should record approval before execution");
  const approveActionStart = html.indexOf("async function approveAction");
  const approvalCall = html.indexOf("/api/v1/cockpit/actions/approve", approveActionStart);
  const guidedProcessCall = html.indexOf("/api/v1/cockpit/processes/", approveActionStart);
  assert.ok(
    approvalCall > approveActionStart && approvalCall < guidedProcessCall,
    "guided actions should record approval before process execution"
  );
  assert.match(html, /What to do now/, "failed validation should become a guided next-step card");
  assert.match(html, /Validation output/, "failed validation should show inline output in the guided panel");
  assert.match(html, /Run validation again/, "failed validation should expose a rerun action in the guided panel");
  assert.match(html, /Open advanced logs/, "advanced logs should be explicitly secondary");
  assert.match(html, /let advancedOpen = false/, "advanced drawer state should survive auto-refresh renders");
  assert.match(html, /openLogRoles/, "open log cards should survive auto-refresh renders");
  assert.match(html, /copyTextWindow/, "text windows should have copy support");
  assert.match(html, /data-copy-nearest/, "text windows should expose copy buttons");
  assert.match(html, /String\.fromCharCode\(10\)/, "cockpit logs should join without embedding newline string literals in inline JS");
  assert.doesNotMatch(html, /join\('\n'\)/, "cockpit logs must not render a real line break inside a string");
  assert.doesNotMatch(html, /external pid\(s\).*status\.port\.pids\.join/, "external pid display should filter real positive PIDs before rendering");

  console.log("cockpit html test passed");
}

run();
