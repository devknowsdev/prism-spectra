import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import type { ApprovalQueue, ApprovalRequestInput } from "../../src/approvals/index.js";
import type { CapabilityApprovalClass, CapabilityCheckpointPolicy } from "../../src/capabilities/manifest.js";
import type { PrismEventLedger } from "../../src/events/index.js";

const execFileAsync = promisify(execFile);
const MAX_LOG_LINES = 500;

type RoleKind = "managed-process" | "one-shot" | "virtual" | "placeholder";
type LogLevel = "info" | "stdout" | "stderr" | "error" | "system";
type ChecklistStatus = "done" | "pending" | "running" | "warn" | "blocked";

type CockpitActionKind =
  | "refresh-status"
  | "start-role"
  | "stop-owned-role"
  | "restart-owned-role"
  | "run-one-shot"
  | "show-logs"
  | "open-linked-app"
  | "acknowledge-external";

interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  note?: string;
}

interface CockpitGuidedAction {
  title: string;
  workflow: string;
  role?: string;
  action: CockpitActionKind;
  approvalClass: CapabilityApprovalClass;
  checkpointPolicy: CapabilityCheckpointPolicy;
  reason: string;
  commandPreview?: string;
  expectedOutcome?: string;
  failureRecovery?: string;
  requiresTerminal?: boolean;
  terminalHint?: string;
}

interface CockpitGuidance {
  workflow: string;
  modeLabel: string;
  missionStatement: string;
  stateSummary: string;
  nextAction: CockpitGuidedAction | null;
  checklist: ChecklistItem[];
}

interface CockpitGatewayProfile {
  host: string;
  port: number;
  mode: "mock" | "real";
  mockExecutors: boolean;
  dbPath: string;
  workDir: string;
}

interface CockpitRole {
  id: string;
  label: string;
  group: string;
  kind: RoleKind;
  description: string;
  cwd?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  port?: number;
  healthUrl?: string;
  disabledReason?: string;
  allowKillPort?: boolean;
}

interface CockpitProfileRole extends CockpitRole {
  commandPreview?: string;
  status?: Record<string, any>;
  logs?: LogEntry[];
}

interface CockpitProfile {
  ok: boolean;
  name: string;
  generatedAt: string;
  gateway: CockpitGatewayProfile;
  roles: CockpitProfileRole[];
  guidance?: CockpitGuidance;
}

interface RunningProcess {
  child: ChildProcessWithoutNullStreams;
  startedAt: string;
  lastExitCode?: number | null;
  lastExitSignal?: NodeJS.Signals | null;
}

interface LogEntry {
  at: string;
  level: LogLevel;
  line: string;
}

interface CockpitOptions {
  host: string;
  port: number;
  token: string;
  mockExecutors: boolean;
  dbPath: string;
  workDir: string;
  approvalQueue: ApprovalQueue;
  eventLedger: PrismEventLedger;
}

const APPROVAL_CLASS_BY_ACTION: Record<CockpitActionKind, CapabilityApprovalClass> = {
  "refresh-status": "observe",
  "start-role": "write",
  "stop-owned-role": "write",
  "restart-owned-role": "write",
  "run-one-shot": "write",
  "show-logs": "observe",
  "open-linked-app": "observe",
  "acknowledge-external": "observe",
};

const CHECKPOINT_POLICY_BY_ACTION: Record<CockpitActionKind, CapabilityCheckpointPolicy> = {
  "refresh-status": "none",
  "start-role": "before_write",
  "stop-owned-role": "before_write",
  "restart-owned-role": "before_write",
  "run-one-shot": "before_write",
  "show-logs": "none",
  "open-linked-app": "none",
  "acknowledge-external": "none",
};

function guidedAction(
  input: Omit<CockpitGuidedAction, "approvalClass" | "checkpointPolicy">
): CockpitGuidedAction {
  return {
    ...input,
    approvalClass: APPROVAL_CLASS_BY_ACTION[input.action],
    checkpointPolicy: CHECKPOINT_POLICY_BY_ACTION[input.action],
  };
}

function isApprovalRequired(action: CockpitActionKind): boolean {
  return APPROVAL_CLASS_BY_ACTION[action] === "write";
}

export function deriveCockpitGuidance(profile: CockpitProfile): CockpitGuidance {
  const modeLabel = profile.gateway.mockExecutors ? "mock mode" : "real mode";
  const missionStatement = "Focus ↔ Spectra bridge validation";

  const gatewayRole = profile.roles.find(role => role.id === "spectra-gateway-current");
  const focusRole = profile.roles.find(role => role.id === "focus-ui");
  const validationRole = profile.roles.find(role => role.id === "spectra-validation");

  const gatewayOk = Boolean(gatewayRole?.status?.healthOk || gatewayRole?.status?.running);
  const focusRunning = Boolean(focusRole?.status?.running);
  const focusExternal = Boolean(focusRole?.status?.externalPortOwner);
  const focusOwned = focusRunning && !focusExternal;
  const focusExited = Boolean(
    focusRole?.status?.lastExitCode !== undefined &&
    focusRole?.status?.lastExitCode !== null &&
    !focusRunning
  );
  const validationRunning = Boolean(validationRole?.status?.running);
  const validationLastExit = validationRole?.status?.lastExitCode;
  const validationPassed = validationLastExit === 0;
  const validationFailed = typeof validationLastExit === "number" && validationLastExit !== 0;
  const validationRun = validationLastExit !== undefined && validationLastExit !== null;

  const checklist: ChecklistItem[] = [
    {
      id: "gateway",
      label: "Spectra gateway running" + (modeLabel ? ` (${modeLabel})` : ""),
      status: gatewayOk ? "done" : "blocked",
    },
    {
      id: "focus",
      label: "Focus UI running and cockpit-owned",
      status: focusOwned ? "done" : focusExternal ? "warn" : focusExited ? "warn" : "pending",
      note: focusExternal ? "External process detected — cockpit does not own this" : undefined,
    },
    {
      id: "validation",
      label: "Spectra validation passed",
      status: validationPassed ? "done" : validationFailed ? "blocked" : validationRunning ? "running" : "pending",
    },
    {
      id: "bridge",
      label: "Bridge test ready to run",
      status: "pending",
    },
  ];

  let stateSummary: string;
  let nextAction: CockpitGuidedAction | null = null;

  if (!gatewayOk) {
    stateSummary = "Gateway unavailable";
    nextAction = guidedAction({
      title: "Refresh Spectra gateway status",
      workflow: "focus-spectra-bridge",
      action: "refresh-status",
      reason: "Cockpit cannot reach the Spectra gateway. Restart it from Terminal.",
      requiresTerminal: true,
      terminalHint: "AI_FORGE_AI_GATEWAY_TOKEN=\"dev-local-token\" AI_FORGE_MOCK_EXECUTORS=1 npm run cockpit",
    });
  } else if (focusExited) {
    stateSummary = `Gateway running (${modeLabel}) · Focus exited`;
    nextAction = guidedAction({
      title: "Restart Focus UI",
      workflow: "focus-spectra-bridge",
      role: "focus-ui",
      action: "restart-owned-role",
      reason: "Focus stopped unexpectedly. Restart it to continue the bridge validation.",
      commandPreview: focusRole?.commandPreview,
      expectedOutcome: "Focus UI is reachable at http://127.0.0.1:4173/ and cockpit-owned.",
      failureRecovery: "Check that ~/Desktop/prism-focus exists and port 4173 is free.",
    });
  } else if (focusExternal) {
    stateSummary = `Gateway running (${modeLabel}) · Focus: external process`;
    nextAction = guidedAction({
      title: "Use externally running Focus",
      workflow: "focus-spectra-bridge",
      role: "focus-ui",
      action: "acknowledge-external",
      reason: "Focus is already running outside the cockpit. You can use it as-is, or stop it in Terminal first if you want the cockpit to take ownership.",
      requiresTerminal: false,
      terminalHint: "lsof -tiTCP:4173 -sTCP:LISTEN | xargs kill",
    });
  } else if (!focusOwned) {
    stateSummary = `Gateway running (${modeLabel}) · Focus: not running`;
    nextAction = guidedAction({
      title: "Start Focus UI",
      workflow: "focus-spectra-bridge",
      role: "focus-ui",
      action: "start-role",
      reason: "Focus is not running. The bridge test requires the browser app on port 4173.",
      commandPreview: focusRole?.commandPreview,
      expectedOutcome: "Focus UI is reachable at http://127.0.0.1:4173/ and cockpit-owned.",
      failureRecovery: "Check that ~/Desktop/prism-focus exists and port 4173 is free.",
    });
  } else if (validationRunning) {
    stateSummary = `Gateway running (${modeLabel}) · Focus owned · Validation running…`;
    nextAction = null;
  } else if (validationFailed) {
    stateSummary = `Gateway running (${modeLabel}) · Focus owned · Validation failed`;
    nextAction = guidedAction({
      title: "Review Spectra Validation logs",
      workflow: "focus-spectra-bridge",
      role: "spectra-validation",
      action: "show-logs",
      reason: "Review the failed validation output below, then rerun validation after fixing the issue.",
      commandPreview: validationRole?.commandPreview,
      failureRecovery: "Use the inline output first. Advanced process controls are optional.",
    });
  } else if (!validationRun || !validationPassed) {
    stateSummary = `Gateway running (${modeLabel}) · Focus owned · Validation not run`;
    nextAction = guidedAction({
      title: "Run Spectra Validation",
      workflow: "focus-spectra-bridge",
      role: "spectra-validation",
      action: "run-one-shot",
      reason: "Gateway and Focus are ready. Run validation to confirm the bridge is clean.",
      commandPreview: validationRole?.commandPreview,
      expectedOutcome: "All checks exit 0. Log appears in the guided panel and the Spectra Validation card.",
      failureRecovery: "If it fails, read the inline output in this guided panel first.",
    });
  } else {
    stateSummary = `Gateway running (${modeLabel}) · Focus owned · Validation passed`;
    nextAction = guidedAction({
      title: "Open Focus",
      workflow: "focus-spectra-bridge",
      action: "open-linked-app",
      reason: "Everything is ready. Open Focus and test Settings → AI → Test Spectra.",
      expectedOutcome: "Focus shows a response from Spectra. The bridge is working.",
    });
  }

  return { workflow: "focus-spectra-bridge", modeLabel, missionStatement, stateSummary, nextAction, checklist };
}

export function renderProjectCockpitHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Prism Spectra Project Cockpit</title>
  <style>
    :root { color-scheme: dark; --bg:#111318; --panel:#181c24; --panel2:#202633; --text:#eef2f7; --muted:#aab4c4; --line:#303849; --good:#7ddc9f; --warn:#ffd37a; --bad:#ff8d8d; --focus:#b7a8ff; --guided-bg:rgba(28,32,46,0.97); --guided-border:#3a4260; --action-bg:#1a2035; --action-border:#3d5291; --checklist-pending:#606880; }
    * { box-sizing: border-box; }
    body { margin:0; font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:radial-gradient(circle at top left,#202335 0,#111318 38rem); color:var(--text); }
    header { padding:22px 28px 14px; border-bottom:1px solid var(--line); background:rgba(17,19,24,0.86); position:sticky; top:0; z-index:3; backdrop-filter:blur(10px); }
    h1 { margin:0 0 6px; font-size:24px; letter-spacing:-0.02em; }
    p { margin:0; color:var(--muted); }
    main { padding:22px 28px 42px; max-width:1320px; margin:0 auto; }
    .toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:0 0 18px; padding:12px; border:1px solid var(--line); border-radius:14px; background:rgba(24,28,36,0.84); }
    label { color:var(--muted); }
    input { background:#0f1218; border:1px solid var(--line); border-radius:10px; color:var(--text); padding:9px 10px; min-width:220px; }
    button { background:var(--panel2); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:8px 11px; cursor:pointer; }
    button:hover:not(:disabled) { border-color:var(--focus); }
    button:disabled { opacity:0.44; cursor:not-allowed; }
    .primary { background:#2b3b5f; border-color:#485e91; }
    .danger { background:#3d2025; border-color:#7b3b42; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); gap:14px; }
    .card { background:rgba(24,28,36,0.93); border:1px solid var(--line); border-radius:16px; padding:15px; min-height:220px; }
    .card h2 { margin:0; font-size:17px; }
    .meta { display:flex; flex-wrap:wrap; gap:7px; margin:10px 0; }
    .pill { border:1px solid var(--line); border-radius:999px; padding:3px 8px; color:var(--muted); background:rgba(255,255,255,0.03); font-size:12px; }
    .ok { color:var(--good); } .warn { color:var(--warn); } .bad { color:var(--bad); }
    .cmd, pre { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; white-space:pre-wrap; word-break:break-word; background:#0d1016; border:1px solid var(--line); border-radius:12px; padding:10px; color:#dbe7ff; }
    .cmd { margin:0; }
    .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    .logs { margin-top:0; max-height:230px; overflow:auto; display:none; }
    .logs.open { display:block; }
    .guided-log { display:block; max-height:260px; overflow:auto; margin:0; }
    .small { font-size:12px; color:var(--muted); }
    .section-title { margin:22px 0 10px; font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:0.1em; }
    .guided-panel { background:var(--guided-bg); border:1px solid var(--guided-border); border-radius:18px; padding:20px 24px; margin-bottom:18px; }
    .mission { font-size:13px; color:var(--muted); margin:0 0 2px; }
    .state-summary { font-size:15px; font-weight:600; margin:0 0 16px; }
    .action-card { background:var(--action-bg); border:1px solid var(--action-border); border-radius:14px; padding:14px 16px; margin-bottom:14px; }
    .action-label { font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em; margin:0 0 6px; }
    .action-title { font-size:17px; font-weight:600; margin:0 0 6px; }
    .action-reason { font-size:13px; color:var(--muted); margin:0 0 10px; }
    .action-preview { margin:0; }
    .action-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; align-items:center; }
    .approve-btn { background:#2b3b5f; border:1px solid #485e91; color:var(--text); border-radius:10px; padding:9px 16px; cursor:pointer; font-size:14px; }
    .approve-btn:hover:not(:disabled) { border-color:var(--focus); }
    .terminal-hint { background:#0d1016; border:1px solid var(--line); border-radius:10px; padding:8px 10px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:#dbe7ff; margin:0; white-space:pre-wrap; word-break:break-word; }
    .waiting-state { color:var(--focus); font-size:14px; font-style:italic; }
    .checklist { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:6px; }
    .checklist li { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:13px; }
    .check-icon { width:16px; height:16px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:10px; }
    .check-done { background:var(--good); color:#000; } .check-pending { background:transparent; border:1.5px solid var(--checklist-pending); } .check-running { background:var(--focus); color:#000; } .check-warn { background:var(--warn); color:#000; } .check-blocked { background:var(--bad); color:#000; }
    .check-note { flex-basis:100%; font-size:11px; color:var(--muted); margin-left:24px; }
    .advanced-toggle { width:100%; text-align:left; background:transparent; border:none; border-bottom:1px solid var(--line); padding:10px 0; color:var(--muted); font-size:13px; cursor:pointer; display:flex; align-items:center; gap:6px; }
    .advanced-toggle:hover { color:var(--text); }
    .advanced-section { display:none; }
    .advanced-section.open { display:block; }
    .text-window { margin:10px 0; border:1px solid var(--line); border-radius:12px; background:#0d1016; overflow:hidden; }
    .text-window pre, .text-window .cmd, .text-window .terminal-hint { border:0; border-radius:0; }
    .text-toolbar { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid var(--line); background:rgba(255,255,255,0.03); }
    .text-title { color:var(--muted); font-size:12px; }
    .copy-btn { padding:5px 8px; font-size:12px; }
  </style>
</head>
<body>
  <header>
    <h1>Prism Spectra Project Cockpit</h1>
    <p>Role-wired local controls for Focus ↔ Spectra bridge work. Fixed commands only; no free-form terminal yet.</p>
  </header>
  <main>
    <div class="toolbar">
      <label for="token">Gateway token</label>
      <input id="token" type="password" autocomplete="off" />
      <button id="saveToken">Save token</button>
      <button id="refresh" class="primary">Refresh status</button>
      <span id="summary" class="small"></span>
    </div>
    <div id="content"></div>
  </main>
  <script>
    const tokenInput = document.getElementById('token');
    const content = document.getElementById('content');
    const summary = document.getElementById('summary');
    let advancedOpen = false;
    const openLogRoles = new Set();
    tokenInput.value = localStorage.getItem('spectraCockpitToken') || 'dev-local-token';

    document.getElementById('saveToken').onclick = () => {
      localStorage.setItem('spectraCockpitToken', tokenInput.value.trim());
      loadProfile();
    };
    document.getElementById('refresh').onclick = () => loadProfile();

    async function api(path, options) {
      const response = await fetch(path, {
        method: options && options.method ? options.method : 'GET',
        headers: { 'content-type': 'application/json', 'x-local-token': tokenInput.value.trim() },
        body: options && options.body ? JSON.stringify(options.body) : undefined
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) throw new Error(data && data.error ? data.error : response.status + ' ' + response.statusText);
      return data;
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[ch]);
    }

    function textWindow(label, text, blockClass) {
      return '<div class="text-window">' +
        '<div class="text-toolbar"><span class="text-title">' + escapeHtml(label) + '</span><button class="copy-btn" data-copy-nearest="pre,.cmd,.terminal-hint">Copy</button></div>' +
        '<pre class="' + escapeHtml(blockClass || '') + '">' + escapeHtml(text) + '</pre>' +
        '</div>';
    }

    async function copyTextWindow(button) {
      var box = button.closest('.text-window');
      var target = box ? box.querySelector('pre,.cmd,.terminal-hint') : null;
      var text = target ? target.innerText : '';
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
        else {
          var area = document.createElement('textarea');
          area.value = text;
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.focus();
          area.select();
          document.execCommand('copy');
          area.remove();
        }
        var old = button.textContent;
        button.textContent = 'Copied';
        setTimeout(function() { button.textContent = old || 'Copy'; }, 1200);
      } catch (error) {
        alert('Copy failed: ' + (error.message || String(error)));
      }
    }

    function stateClass(status) {
      if (status.externalPortOwner) return 'warn';
      if (status.running || status.healthOk) return 'ok';
      if (status.disabled || status.kind === 'placeholder') return 'warn';
      if (status.port && status.port.listening) return 'warn';
      return 'bad';
    }

    function stateText(status) {
      if (status.disabled) return 'disabled';
      if (status.running) return 'running';
      if (status.externalPortOwner) return status.healthOk ? 'external healthy' : 'external process';
      if (status.healthOk) return 'healthy';
      if (status.port && status.port.listening) return 'port occupied';
      if (status.lastExitCode !== undefined && status.lastExitCode !== null) return 'exited ' + status.lastExitCode;
      if (status.kind === 'virtual') return 'current gateway';
      return 'stopped';
    }

    function roleCard(role) {
      const status = role.status || {};
      const disabled = role.disabled || role.kind === 'placeholder';
      const externalPortOwner = Boolean(status.externalPortOwner);
      const canStart = !disabled && role.kind !== 'virtual' && !status.running && !externalPortOwner;
      const canStop = !disabled && status.running;
      const canRestart = !disabled && role.kind !== 'virtual' && !externalPortOwner;
      const canKillPort = !disabled && role.allowKillPort && role.port && status.port && status.port.listening && status.running;
      const manualKill = role.port ? 'lsof -tiTCP:' + role.port + ' -sTCP:LISTEN | xargs kill' : '';
      const logs = (role.logs || []).slice(-80).map(line => '[' + line.at + '] ' + line.level + ': ' + line.line).join(String.fromCharCode(10));
      return '<article class="card" data-role="' + escapeHtml(role.id) + '">' +
        '<h2>' + escapeHtml(role.label) + '</h2>' +
        '<p>' + escapeHtml(role.description) + '</p>' +
        '<div class="meta">' +
          '<span class="pill">' + escapeHtml(role.group) + '</span>' +
          '<span class="pill ' + stateClass(status) + '">' + stateText(status) + '</span>' +
          (role.port ? '<span class="pill">port ' + escapeHtml(role.port) + '</span>' : '') +
          (status.pid ? '<span class="pill">pid ' + escapeHtml(status.pid) + '</span>' : '') +
          (function() { if (!externalPortOwner || !status.port) return ''; var realPids = (status.port.pids || []).filter(function(p) { return typeof p === 'number' && Number.isFinite(p) && p > 0; }); return realPids.length ? '<span class="pill warn">external pid(s) ' + escapeHtml(realPids.join(', ')) + '</span>' : ''; })() +
          (status.cwdExists === false ? '<span class="pill bad">cwd missing</span>' : '') +
        '</div>' +
        (role.cwd ? '<div class="small">cwd: ' + escapeHtml(role.cwd) + '</div>' : '') +
        (role.healthUrl ? '<div class="small">health: ' + escapeHtml(role.healthUrl) + '</div>' : '') +
        textWindow('Command', role.commandPreview || 'No command wired yet.', 'cmd') +
        (externalPortOwner ? '<p class="warn">External process detected. The cockpit will not kill it from the browser. Run this manually if you want to free the port:</p>' + textWindow('Manual terminal command', manualKill, 'cmd') : '') +
        (role.disabledReason ? '<p class="warn">' + escapeHtml(role.disabledReason) + '</p>' : '') +
        '<div class="actions">' +
          '<button class="primary" data-action="start" ' + (canStart ? '' : 'disabled') + '>Start / Run</button>' +
          '<button data-action="restart" ' + (canRestart ? '' : 'disabled') + '>Restart</button>' +
          '<button data-action="stop" ' + (canStop ? '' : 'disabled') + '>Stop</button>' +
          '<button class="danger" data-action="kill-port" ' + (canKillPort ? '' : 'disabled') + '>Kill port</button>' +
          '<button data-action="toggle-logs">Logs</button>' +
        '</div>' +
        textWindow('Logs', logs || 'No logs yet.', 'logs') +
      '</article>';
    }

    function checkIcon(status) {
      var icons = { done:'✓', pending:'', running:'…', warn:'!', blocked:'✗' };
      return '<span class="check-icon check-' + status + '">' + (icons[status] || '') + '</span>';
    }

    function renderChecklist(items) {
      return '<ul class="checklist">' + items.map(function(item) {
        return '<li>' + checkIcon(item.status) + '<span class="check-label">' + escapeHtml(item.label) + '</span>' + (item.note ? '<span class="check-note">' + escapeHtml(item.note) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }

    function roleLabelById(profile, roleId) {
      var role = (profile.roles || []).find(function(r) { return r.id === roleId; });
      return role ? role.label : roleId;
    }

    function encodeGuidedAction(action) {
      return encodeURIComponent(JSON.stringify(action));
    }

    function guidedButton(action, label) {
      return '<button class="approve-btn" data-guided-action="' + encodeGuidedAction(action) + '">' + escapeHtml(label) + '</button>';
    }

    function validationLogPreview(profile) {
      var role = (profile.roles || []).find(function(r) { return r.id === 'spectra-validation'; });
      var lines = (role && role.logs ? role.logs : []).slice(-40).map(function(line) {
        return '[' + line.at + '] ' + line.level + ': ' + line.line;
      }).join(String.fromCharCode(10));
      return '<div class="action-card">' +
        '<div class="action-label">Validation output</div>' +
        textWindow('Validation output', lines || 'No validation output is available yet. Run validation again to capture fresh output here.', 'guided-log') +
        '</div>';
    }

    function renderNextAction(action, profile) {
      if (!action) return '';
      if (action.action === 'show-logs') {
        var rerun = {
          title: 'Run Spectra Validation',
          workflow: action.workflow,
          role: action.role,
          action: 'run-one-shot',
          approvalClass: 'write',
          checkpointPolicy: 'before_write',
          reason: 'Run validation again after reviewing the output.',
          commandPreview: action.commandPreview
        };
        return '<div class="action-card">' +
          '<div class="action-label">What to do now</div>' +
          '<div class="action-title">Review the failed validation output below.</div>' +
          '<div class="action-reason">The guided panel is now the main path. Advanced process controls are only for deeper inspection.</div>' +
          '<div class="action-row">' + guidedButton(action, 'Open advanced logs') + guidedButton(rerun, 'Run validation again') + '</div>' +
          '</div>';
      }
      if (action.action === 'open-linked-app') {
        return '<div class="action-card">' +
          '<div class="action-label">Ready</div>' +
          '<div class="action-title">' + escapeHtml(action.reason) + '</div>' +
          '<div class="action-row">' + guidedButton(action, 'Open Focus') + '</div>' +
          '</div>';
      }
      if (action.approvalClass !== 'write') {
        return '<div class="action-card">' +
          '<div class="action-label">Status</div>' +
          '<div class="action-title">' + escapeHtml(action.reason) + '</div>' +
          (action.terminalHint ? textWindow('Terminal hint', action.terminalHint, 'terminal-hint') : '') +
          '</div>';
      }
      var actionTitle = action.title || ({
        'start-role': 'Start ' + (action.role ? roleLabelById(profile, action.role) : 'role'),
        'restart-owned-role': 'Restart ' + (action.role ? roleLabelById(profile, action.role) : 'role'),
        'run-one-shot': 'Run ' + (action.role ? roleLabelById(profile, action.role) : 'check')
      }[action.action] || action.action);
      return '<div class="action-card">' +
        '<div class="action-label">Next safe action</div>' +
        '<div class="action-title">▶  ' + escapeHtml(actionTitle) + '</div>' +
        '<div class="action-reason">' + escapeHtml(action.reason) + '</div>' +
        (action.commandPreview ? textWindow('Command preview', action.commandPreview, 'cmd action-preview') : '') +
        '<div class="action-row">' + guidedButton(action, 'Approve — ' + actionTitle) + '</div>' +
        '</div>';
    }

    async function approveAction(action) {
      try {
        if (action.action === 'show-logs') {
          advancedOpen = true;
          if (action.role) openLogRoles.add(action.role);
          var card = document.querySelector('[data-role="' + action.role + '"]');
          var section = document.querySelector('.advanced-section');
          var toggle = document.querySelector('.advanced-toggle');
          if (section) section.classList.add('open');
          if (toggle) toggle.textContent = '▲ Hide advanced process controls';
          if (card) {
            var logsEl = card.querySelector('.logs');
            if (logsEl) logsEl.classList.add('open');
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          return;
        }
        if (action.action === 'open-linked-app') {
          window.open('http://127.0.0.1:4173/', '_blank');
          return;
        }
        if (action.approvalClass === 'write') {
          await api('/api/v1/cockpit/actions/approve', {
            method: 'POST',
            body: { nextAction: action }
          });
        }
        var apiAction = { 'start-role':'start', 'restart-owned-role':'restart', 'run-one-shot':'start' }[action.action];
        if (apiAction && action.role) {
          await api('/api/v1/cockpit/processes/' + encodeURIComponent(action.role) + '/' + apiAction, { method:'POST' });
          await loadProfile();
        }
      } catch (error) {
        alert(error.message || String(error));
      }
    }

    function renderGuidedPanel(profile) {
      var g = profile.guidance;
      if (!g) return '';
      var showValidationOutput = g.nextAction && g.nextAction.action === 'show-logs';
      return '<div class="guided-panel">' +
        '<div class="mission">' + escapeHtml(g.missionStatement) + ' · ' + escapeHtml(g.modeLabel) + '</div>' +
        '<div class="state-summary">' + escapeHtml(g.stateSummary) + '</div>' +
        (g.nextAction ? renderNextAction(g.nextAction, profile) : '<div class="waiting-state">Waiting for validation to complete…</div>') +
        (showValidationOutput ? validationLogPreview(profile) : '') +
        '<div class="section-title" style="margin-top:14px">Readiness checklist</div>' + renderChecklist(g.checklist) +
        '</div>';
    }

    function toggleAdvanced(btn) {
      var section = btn.nextElementSibling;
      advancedOpen = section.classList.toggle('open');
      btn.textContent = (advancedOpen ? '▲ Hide' : '▼ Show') + ' advanced process controls';
    }

    function render(profile) {
      summary.textContent = 'Gateway mode: ' + profile.gateway.mode + ' · host: ' + profile.gateway.host + ':' + profile.gateway.port;
      var groups = [];
      for (var role of profile.roles) if (!groups.includes(role.group)) groups.push(role.group);
      var cardsHtml = groups.map(function(group) {
        var cards = profile.roles.filter(function(r) { return r.group === group; }).map(roleCard).join('');
        return '<div class="section-title">' + escapeHtml(group) + '</div><div class="grid">' + cards + '</div>';
      }).join('');
      content.innerHTML = renderGuidedPanel(profile) +
        '<button class="advanced-toggle">' + (advancedOpen ? '▲ Hide' : '▼ Show') + ' advanced process controls</button>' +
        '<div class="advanced-section' + (advancedOpen ? ' open' : '') + '">' + cardsHtml + '</div>';

      var advancedToggle = content.querySelector('.advanced-toggle');
      if (advancedToggle) advancedToggle.onclick = function() { toggleAdvanced(advancedToggle); };

      content.querySelectorAll('[data-guided-action]').forEach(function(button) {
        button.onclick = function() {
          approveAction(JSON.parse(decodeURIComponent(button.getAttribute('data-guided-action') || '')));
        };
      });

      content.querySelectorAll('[data-copy-nearest]').forEach(function(button) {
        button.onclick = function() { copyTextWindow(button); };
      });

      content.querySelectorAll('.card').forEach(function(card) {
        var roleId = card.getAttribute('data-role');
        var logsEl = card.querySelector('.logs');
        if (roleId && openLogRoles.has(roleId) && logsEl) logsEl.classList.add('open');
        card.querySelectorAll('button').forEach(function(button) {
          var action = button.getAttribute('data-action');
          if (!action) return;
          button.onclick = function() { runAction(roleId, action, card); };
        });
      });
    }

    async function runAction(id, action, card) {
      try {
        if (action === 'toggle-logs') {
          var logsEl = card.querySelector('.logs');
          var open = logsEl.classList.toggle('open');
          if (id) {
            if (open) openLogRoles.add(id); else openLogRoles.delete(id);
          }
          return;
        }
        await api('/api/v1/cockpit/processes/' + encodeURIComponent(id) + '/' + action, { method:'POST' });
        await loadProfile();
      } catch (error) {
        alert(error.message || String(error));
      }
    }

    async function loadProfile() {
      try {
        const profile = await api('/api/v1/cockpit/profile');
        render(profile);
      } catch (error) {
        content.innerHTML = textWindow('Cockpit API error', 'Cockpit API error: ' + (error.message || String(error)), 'bad');
        content.querySelectorAll('[data-copy-nearest]').forEach(function(button) {
          button.onclick = function() { copyTextWindow(button); };
        });
      }
    }

    loadProfile();
    setInterval(loadProfile, 4000);
  </script>
</body>
</html>`;
}

export function createProjectCockpitRouter(options: CockpitOptions) {
  const cockpit = new ProjectCockpit(options);
  return async function handleProjectCockpitRequest(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    if (req.method === "GET" && url.pathname === "/api/v1/cockpit/profile") return jsonResponse(res, 200, await cockpit.profile());
    if (req.method === "GET" && url.pathname === "/api/v1/cockpit/processes") return jsonResponse(res, 200, { ok: true, roles: await cockpit.rolesWithStatus() });
    if (url.pathname === "/api/v1/cockpit/actions/approve") {
      if (req.method !== "POST") return jsonResponse(res, 405, { ok: false, error: "method not allowed" });
      const body = await readJsonBody(req);
      return jsonResponse(res, 200, handleApproveGuidedAction(options, body));
    }

    const match = url.pathname.match(/^\/api\/v1\/cockpit\/processes\/([^/]+)\/(start|stop|restart|kill-port|logs)$/);
    if (!match) return false;

    const id = decodeURIComponent(match[1]);
    const action = match[2];

    if (req.method === "GET" && action === "logs") return jsonResponse(res, 200, { ok: true, id, logs: cockpit.logsFor(id) });
    if (req.method !== "POST") return jsonResponse(res, 405, { ok: false, error: "method not allowed" });
    if (action === "start") return jsonResponse(res, 200, await cockpit.start(id));
    if (action === "stop") return jsonResponse(res, 200, await cockpit.stop(id));
    if (action === "restart") return jsonResponse(res, 200, await cockpit.restart(id));
    if (action === "kill-port") return jsonResponse(res, 200, await cockpit.killPort(id));
    return false;
  };
}

export function handleApproveGuidedAction(
  options: Pick<CockpitOptions, "approvalQueue">,
  body: unknown
) {
  const raw =
    body && typeof body === "object" && "nextAction" in body
      ? (body as { nextAction?: unknown }).nextAction
      : undefined;
  if (!raw || typeof raw !== "object") {
    throw new Error("nextAction must be an object");
  }

  const action = raw as Partial<CockpitGuidedAction>;
  if (typeof action.action !== "string" || !Object.hasOwn(APPROVAL_CLASS_BY_ACTION, action.action)) {
    throw new Error("unknown cockpit action");
  }
  const kind = action.action as CockpitActionKind;
  if (!isApprovalRequired(kind)) {
    return { ok: true, approvalSkipped: true };
  }
  if (typeof action.role !== "string" || action.role.trim() === "") {
    throw new Error("write-class cockpit actions require a role");
  }
  if (typeof action.reason !== "string" || action.reason.trim() === "") {
    throw new Error("write-class cockpit actions require a reason");
  }

  const input: ApprovalRequestInput = {
    title: typeof action.title === "string" && action.title.trim() ? action.title : kind,
    summary: action.reason,
    approvalClass: APPROVAL_CLASS_BY_ACTION[kind],
    checkpointPolicy: CHECKPOINT_POLICY_BY_ACTION[kind],
    relatedArtifactIds: [],
    relatedFilePaths: [],
    previewAvailable: Boolean(action.commandPreview),
    previewSummary: action.expectedOutcome,
    cliEquivalent: action.commandPreview,
    riskNotes: action.failureRecovery ? [action.failureRecovery] : [],
    localRemoteBoundary: "local-only",
    requestedBy: "dave-cockpit",
  };
  const approval = options.approvalQueue.requestApproval(input);
  const resolved = options.approvalQueue.resolveApproval(approval.id, {
    status: "approved",
    decidedAt: new Date().toISOString(),
    decidedBy: "dave-cockpit",
  });
  return { ok: true, approvalId: resolved.id };
}

class ProjectCockpit {
  private readonly roles: CockpitRole[];
  private readonly running = new Map<string, RunningProcess>();
  private readonly logs = new Map<string, LogEntry[]>();

  constructor(private readonly options: CockpitOptions) {
    this.roles = buildRoles(options);
    for (const role of this.roles) this.logs.set(role.id, []);
  }

  async profile(): Promise<CockpitProfile> {
    const roles = await this.rolesWithStatus();
    const base: CockpitProfile = {
      ok: true,
      name: "Focus ↔ Spectra Bridge",
      generatedAt: new Date().toISOString(),
      gateway: {
        host: this.options.host,
        port: this.options.port,
        mode: this.options.mockExecutors ? "mock" : "real",
        mockExecutors: this.options.mockExecutors,
        dbPath: this.options.dbPath,
        workDir: this.options.workDir,
      },
      roles,
    };
    return { ...base, guidance: deriveCockpitGuidance(base) };
  }

  async rolesWithStatus(): Promise<CockpitProfileRole[]> {
    return Promise.all(this.roles.map(async role => ({
      ...role,
      commandPreview: commandPreview(role),
      status: await this.status(role),
      logs: this.logsFor(role.id).slice(-60),
    })));
  }

  logsFor(id: string) {
    return this.logs.get(id) ?? [];
  }

  async start(id: string) {
    const role = this.requireRole(id);
    if (role.kind === "virtual") return { ok: false, error: `${role.label} is represented by the running gateway; start it from the shell for now.` };
    if (role.kind === "placeholder") return { ok: false, error: role.disabledReason ?? `${role.label} is not wired yet.` };
    if (!role.command) return { ok: false, error: `${role.label} has no command configured.` };

    const existing = this.running.get(role.id);
    if (existing && !existing.child.killed && existing.child.exitCode === null) return { ok: true, alreadyRunning: true, id: role.id, pid: existing.child.pid };

    if (role.cwd) {
      try { await fs.access(role.cwd); }
      catch { this.append(role.id, "error", `Working directory does not exist: ${role.cwd}`); return { ok: false, error: `Working directory does not exist: ${role.cwd}` }; }
    }

    if (role.port) {
      const port = await listeningPids(role.port);
      if (port.listening) {
        const owner = port.pids.length ? `pid(s): ${port.pids.join(", ")}` : "unknown pid";
        this.append(role.id, "error", `Port ${role.port} is already owned by an external process (${owner}).`);
        return { ok: false, error: `Port ${role.port} is already in use by an external process. Free the port manually first if you want the cockpit to own this role.` };
      }
    }

    this.append(role.id, "system", `$ ${commandPreview(role)}`);
    const child = spawn(role.command, role.args ?? [], {
      cwd: role.cwd,
      env: { ...process.env, ...(role.env ?? {}) },
      stdio: "pipe",
    });

    const running: RunningProcess = { child, startedAt: new Date().toISOString() };
    this.running.set(role.id, running);

    child.stdout.on("data", chunk => this.appendLines(role.id, "stdout", chunk));
    child.stderr.on("data", chunk => this.appendLines(role.id, "stderr", chunk));
    child.on("error", error => this.append(role.id, "error", error.message));
    child.on("close", (code, signal) => {
      running.lastExitCode = code;
      running.lastExitSignal = signal;
      this.append(role.id, "system", `process exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    });

    return { ok: true, id: role.id, pid: child.pid };
  }

  async stop(id: string) {
    const role = this.requireRole(id);
    const running = this.running.get(role.id);
    if (!running || running.child.exitCode !== null) return { ok: true, id: role.id, stopped: false, message: "No managed process is running." };

    running.child.kill("SIGTERM");
    this.append(role.id, "system", "sent SIGTERM");
    setTimeout(() => {
      if (running.child.exitCode === null && !running.child.killed) {
        running.child.kill("SIGKILL");
        this.append(role.id, "system", "sent SIGKILL after timeout");
      }
    }, 1800);
    return { ok: true, id: role.id, stopped: true };
  }

  async restart(id: string) {
    await this.stop(id);
    await new Promise(resolve => setTimeout(resolve, 450));
    return this.start(id);
  }

  async killPort(id: string) {
    const role = this.requireRole(id);
    if (!role.port || role.allowKillPort === false) return { ok: false, error: `${role.label} does not allow kill-port from the cockpit.` };

    const running = this.running.get(role.id);
    const isManaged = Boolean(running && running.child.exitCode === null && !running.child.killed);
    if (!isManaged) {
      const manual = `lsof -tiTCP:${role.port} -sTCP:LISTEN | xargs kill`;
      this.append(role.id, "error", `Refusing to kill externally-owned port ${role.port}. Manual command: ${manual}`);
      return { ok: false, error: `Refusing to kill externally-owned port ${role.port} from the browser. Run manually: ${manual}` };
    }

    const port = await listeningPids(role.port);
    if (!port.listening || port.pids.length === 0) return { ok: true, id: role.id, killed: [], message: `No listener on port ${role.port}.` };

    const childPid = running?.child.pid;
    const unsafePids = port.pids.filter(pid => pid === process.pid || pid === process.ppid || pid !== childPid);
    if (unsafePids.length > 0) {
      this.append(role.id, "error", `Refusing to kill unexpected pid(s) on port ${role.port}: ${unsafePids.join(", ")}`);
      return { ok: false, error: `Refusing to kill unexpected pid(s) on port ${role.port}: ${unsafePids.join(", ")}` };
    }

    const killed: number[] = [];
    for (const pid of port.pids) {
      try { process.kill(pid, "SIGTERM"); killed.push(pid); }
      catch (error) { this.append(role.id, "error", `Failed to kill pid ${pid}: ${(error as Error).message}`); }
    }
    this.append(role.id, "system", `sent SIGTERM to port ${role.port} pid(s): ${killed.join(", ")}`);
    return { ok: true, id: role.id, killed };
  }

  private async status(role: CockpitRole) {
    const running = this.running.get(role.id);
    const isRunning = Boolean(running && running.child.exitCode === null && !running.child.killed);
    const port = role.port ? await listeningPids(role.port) : null;
    const cwdExists = role.cwd ? await exists(role.cwd) : undefined;
    const health = role.healthUrl ? await quickHealth(role.healthUrl, this.options.token) : null;
    const externalPortOwner = role.kind !== "virtual" && !isRunning && Boolean(port?.listening);
    return {
      kind: role.kind,
      disabled: role.kind === "placeholder",
      running: isRunning,
      externalPortOwner,
      pid: isRunning ? running?.child.pid : undefined,
      startedAt: running?.startedAt,
      lastExitCode: running?.lastExitCode,
      lastExitSignal: running?.lastExitSignal,
      cwdExists,
      port,
      healthOk: health?.ok ?? false,
      health,
    };
  }

  private requireRole(id: string) {
    const role = this.roles.find(candidate => candidate.id === id);
    if (!role) throw new Error(`Unknown cockpit role: ${id}`);
    return role;
  }

  private appendLines(id: string, level: LogLevel, chunk: Buffer | string) {
    String(chunk).split(/\r?\n/).filter(Boolean).forEach(line => this.append(id, level, line));
  }

  private append(id: string, level: LogLevel, line: string) {
    const entries = this.logs.get(id) ?? [];
    entries.push({ at: new Date().toISOString(), level, line });
    while (entries.length > MAX_LOG_LINES) entries.shift();
    this.logs.set(id, entries);
  }
}

function buildRoles(options: CockpitOptions): CockpitRole[] {
  const spectraDir = resolveHome(process.env.PRISM_SPECTRA_DIR ?? process.cwd());
  const focusDir = resolveHome(process.env.PRISM_FOCUS_DIR ?? path.join(os.homedir(), "Desktop", "prism-focus"));
  const beamDir = resolveHome(process.env.PRISM_BEAM_DIR ?? path.join(os.homedir(), "Desktop", "prism-beam"));

  return [
    { id: "spectra-gateway-current", label: "Spectra Gateway", group: "Core runtime", kind: "virtual", description: "The currently running gateway that serves this cockpit and the Focus AI bridge.", cwd: spectraDir, port: options.port, healthUrl: `http://${options.host}:${options.port}/api/v1/health`, allowKillPort: false },
    { id: "focus-ui", label: "Focus UI", group: "Core runtime", kind: "managed-process", description: "Starts the Prism Focus browser app with a labelled, managed local server.", cwd: focusDir, command: "python3", args: ["-m", "http.server", "4173"], port: 4173, healthUrl: "http://127.0.0.1:4173/", allowKillPort: true },
    { id: "spectra-validation", label: "Spectra Validation", group: "Validation", kind: "one-shot", description: "Runs the current low-noise Spectra checks for this bridge slice.", cwd: spectraDir, command: "bash", args: ["-lc", "npm run typecheck && npm run test:ai-request && npm run test:cockpit"] },
    { id: "spectra-git-state", label: "Spectra Git State", group: "Validation", kind: "one-shot", description: "Shows current Spectra branch, local status, and recent commits.", cwd: spectraDir, command: "bash", args: ["-lc", "printf 'branch: '; git branch --show-current; git status --short; git log --oneline -5"] },
    { id: "focus-git-state", label: "Focus Git State", group: "Validation", kind: "one-shot", description: "Shows current Focus branch, local status, and recent commits.", cwd: focusDir, command: "bash", args: ["-lc", "printf 'branch: '; git branch --show-current; git status --short; git log --oneline -5"] },
    { id: "ollama-status", label: "Ollama Status", group: "Local models", kind: "one-shot", description: "Lists installed and currently loaded Ollama models without launching real inference.", command: "bash", args: ["-lc", "ollama list && printf '\n--- loaded models ---\n' && ollama ps"] },
    { id: "vibe-coder-cli", label: "Vibe-Coder CLI", group: "Future interfaces", kind: "placeholder", description: "Reserved launch surface for a future vibe-coder CLI interface.", cwd: spectraDir, disabledReason: "Not built yet. This card locks the intended cockpit slot without pretending it is available." },
    { id: "prism-build", label: "Prism Build", group: "Future interfaces", kind: "placeholder", description: "Reserved launch surface for a future Prism Build interface.", cwd: spectraDir, disabledReason: "Not built yet. Next step is to define safe build presets and review gates." },
    { id: "beam-session-log", label: "Beam Session Log", group: "Reference layer", kind: "one-shot", description: "Read-only Beam orientation snapshot. Does not write progress logs.", cwd: beamDir, command: "bash", args: ["-lc", "printf 'branch: '; git branch --show-current; git status --short; printf '\nRecent progress markers:\n'; grep -n \"Focus\|Spectra\|cockpit\" AI_PROGRESS_LOG.md | tail -20 || true"] },
  ];
}

function commandPreview(role: CockpitRole) {
  if (!role.command) return role.disabledReason ?? "No command configured.";
  const env = role.env && Object.keys(role.env).length ? Object.entries(role.env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ") + " " : "";
  return `${env}${[role.command, ...(role.args ?? [])].map(shellWord).join(" ")}`;
}

function shellWord(value: string) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function parsePidOutput(raw: string): number[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  return trimmed.split(/\s+/).map(token => parseInt(token, 10)).filter(n => Number.isInteger(n) && n > 0);
}

async function listeningPids(port: number) {
  const result = await safeExec("lsof", ["-tiTCP:" + String(port), "-sTCP:LISTEN"], 2200);
  const pids = parsePidOutput(result.output);
  return { ok: result.ok || pids.length === 0, port, listening: pids.length > 0, pids, error: result.ok ? undefined : result.error };
}

async function quickHealth(url: string, token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const headers: Record<string, string> = {};
    if (url.includes("/api/v1/")) headers["x-local-token"] = token;
    const response = await fetch(url, { headers, signal: controller.signal });
    return { ok: response.ok, status: response.status, statusText: response.statusText };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

async function exists(targetPath: string) {
  try { await fs.access(targetPath); return true; }
  catch { return false; }
}

async function safeExec(command: string, args: string[], timeout = 3000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, maxBuffer: 512 * 1024 });
    return { ok: true, output: String(stdout ?? "").trim(), error: String(stderr ?? "").trim() || undefined };
  } catch (error) {
    const err = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer; code?: string | number };
    return { ok: false, output: String(err.stdout ?? "").trim(), error: String(err.stderr ?? "").trim() || err.message || String(err.code ?? "command failed") };
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function resolveHome(input: string) {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

function jsonResponse(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "x-local-token,content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body, null, 2));
}
