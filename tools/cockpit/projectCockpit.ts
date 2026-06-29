import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_LOG_LINES = 500;

type RoleKind = "managed-process" | "one-shot" | "virtual" | "placeholder";

type LogLevel = "info" | "stdout" | "stderr" | "error" | "system";

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
}

export function renderProjectCockpitHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Prism Spectra Project Cockpit</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111318;
      --panel: #181c24;
      --panel2: #202633;
      --text: #eef2f7;
      --muted: #aab4c4;
      --line: #303849;
      --good: #7ddc9f;
      --warn: #ffd37a;
      --bad: #ff8d8d;
      --focus: #b7a8ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top left, #202335 0, #111318 38rem);
      color: var(--text);
    }
    header {
      padding: 22px 28px 14px;
      border-bottom: 1px solid var(--line);
      background: rgba(17,19,24,0.86);
      position: sticky;
      top: 0;
      z-index: 3;
      backdrop-filter: blur(10px);
    }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: -0.02em; }
    p { margin: 0; color: var(--muted); }
    main { padding: 22px 28px 42px; max-width: 1320px; margin: 0 auto; }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin: 0 0 18px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(24,28,36,0.84);
    }
    label { color: var(--muted); }
    input {
      background: #0f1218;
      border: 1px solid var(--line);
      border-radius: 10px;
      color: var(--text);
      padding: 9px 10px;
      min-width: 220px;
    }
    button {
      background: var(--panel2);
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px 11px;
      cursor: pointer;
    }
    button:hover:not(:disabled) { border-color: var(--focus); }
    button:disabled { opacity: 0.44; cursor: not-allowed; }
    .primary { background: #2b3b5f; border-color: #485e91; }
    .danger { background: #3d2025; border-color: #7b3b42; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
      gap: 14px;
    }
    .card {
      background: rgba(24,28,36,0.93);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 15px;
      min-height: 220px;
    }
    .card h2 { margin: 0; font-size: 17px; }
    .meta { display: flex; flex-wrap: wrap; gap: 7px; margin: 10px 0; }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
      color: var(--muted);
      background: rgba(255,255,255,0.03);
      font-size: 12px;
    }
    .ok { color: var(--good); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }
    .cmd, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      background: #0d1016;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      color: #dbe7ff;
    }
    .cmd { margin: 10px 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .logs {
      margin-top: 10px;
      max-height: 230px;
      overflow: auto;
      display: none;
    }
    .logs.open { display: block; }
    .small { font-size: 12px; color: var(--muted); }
    .section-title {
      margin: 22px 0 10px;
      font-size: 13px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
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
    tokenInput.value = localStorage.getItem('spectraCockpitToken') || 'dev-local-token';

    document.getElementById('saveToken').onclick = () => {
      localStorage.setItem('spectraCockpitToken', tokenInput.value.trim());
      loadProfile();
    };
    document.getElementById('refresh').onclick = () => loadProfile();

    async function api(path, options) {
      const response = await fetch(path, {
        method: options && options.method ? options.method : 'GET',
        headers: {
          'content-type': 'application/json',
          'x-local-token': tokenInput.value.trim()
        },
        body: options && options.body ? JSON.stringify(options.body) : undefined
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) {
        const message = data && data.error ? data.error : response.status + ' ' + response.statusText;
        throw new Error(message);
      }
      return data;
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
      })[ch]);
    }

    function stateClass(status) {
      if (status.running || status.healthOk) return 'ok';
      if (status.disabled || status.kind === 'placeholder') return 'warn';
      if (status.port && status.port.listening) return 'warn';
      return 'bad';
    }

    function stateText(status) {
      if (status.disabled) return 'disabled';
      if (status.running) return 'running';
      if (status.healthOk) return 'healthy';
      if (status.port && status.port.listening) return 'port occupied';
      if (status.lastExitCode !== undefined && status.lastExitCode !== null) return 'exited ' + status.lastExitCode;
      if (status.kind === 'virtual') return 'current gateway';
      return 'stopped';
    }

    function roleCard(role) {
      const status = role.status || {};
      const disabled = role.disabled || role.kind === 'placeholder';
      const canStart = !disabled && role.kind !== 'virtual' && !status.running;
      const canStop = !disabled && status.running;
      const canRestart = !disabled && role.kind !== 'virtual';
      const canKillPort = !disabled && role.allowKillPort && role.port && status.port && status.port.listening;
      const logs = (role.logs || []).slice(-80).map(line => '[' + line.at + '] ' + line.level + ': ' + line.line).join('\\n');
      return '<article class="card" data-role="' + escapeHtml(role.id) + '">' +
        '<h2>' + escapeHtml(role.label) + '</h2>' +
        '<p>' + escapeHtml(role.description) + '</p>' +
        '<div class="meta">' +
          '<span class="pill">' + escapeHtml(role.group) + '</span>' +
          '<span class="pill ' + stateClass(status) + '">' + stateText(status) + '</span>' +
          (role.port ? '<span class="pill">port ' + escapeHtml(role.port) + '</span>' : '') +
          (status.pid ? '<span class="pill">pid ' + escapeHtml(status.pid) + '</span>' : '') +
          (status.cwdExists === false ? '<span class="pill bad">cwd missing</span>' : '') +
        '</div>' +
        (role.cwd ? '<div class="small">cwd: ' + escapeHtml(role.cwd) + '</div>' : '') +
        (role.healthUrl ? '<div class="small">health: ' + escapeHtml(role.healthUrl) + '</div>' : '') +
        '<div class="cmd">' + escapeHtml(role.commandPreview || 'No command wired yet.') + '</div>' +
        (role.disabledReason ? '<p class="warn">' + escapeHtml(role.disabledReason) + '</p>' : '') +
        '<div class="actions">' +
          '<button class="primary" data-action="start" ' + (canStart ? '' : 'disabled') + '>Start / Run</button>' +
          '<button data-action="restart" ' + (canRestart ? '' : 'disabled') + '>Restart</button>' +
          '<button data-action="stop" ' + (canStop ? '' : 'disabled') + '>Stop</button>' +
          '<button class="danger" data-action="kill-port" ' + (canKillPort ? '' : 'disabled') + '>Kill port</button>' +
          '<button data-action="toggle-logs">Logs</button>' +
        '</div>' +
        '<pre class="logs">' + escapeHtml(logs || 'No logs yet.') + '</pre>' +
      '</article>';
    }

    function render(profile) {
      summary.textContent = 'Gateway mode: ' + profile.gateway.mode + ' · host: ' + profile.gateway.host + ':' + profile.gateway.port;
      const groups = [];
      for (const role of profile.roles) {
        if (!groups.includes(role.group)) groups.push(role.group);
      }
      content.innerHTML = groups.map(group => {
        const cards = profile.roles.filter(role => role.group === group).map(roleCard).join('');
        return '<div class="section-title">' + escapeHtml(group) + '</div><div class="grid">' + cards + '</div>';
      }).join('');
      content.querySelectorAll('.card').forEach(card => {
        card.querySelectorAll('button').forEach(button => {
          const action = button.getAttribute('data-action');
          button.onclick = () => runAction(card.getAttribute('data-role'), action, card);
        });
      });
    }

    async function runAction(id, action, card) {
      try {
        if (action === 'toggle-logs') {
          card.querySelector('.logs').classList.toggle('open');
          return;
        }
        await api('/api/v1/cockpit/processes/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
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
        content.innerHTML = '<pre class="bad">Cockpit API error: ' + escapeHtml(error.message || String(error)) + '</pre>';
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
    if (req.method === "GET" && url.pathname === "/api/v1/cockpit/profile") {
      return jsonResponse(res, 200, await cockpit.profile());
    }

    if (req.method === "GET" && url.pathname === "/api/v1/cockpit/processes") {
      return jsonResponse(res, 200, { ok: true, roles: await cockpit.rolesWithStatus() });
    }

    const match = url.pathname.match(/^\/api\/v1\/cockpit\/processes\/([^/]+)\/(start|stop|restart|kill-port|logs)$/);
    if (!match) return false;

    const id = decodeURIComponent(match[1]);
    const action = match[2];

    if (req.method === "GET" && action === "logs") {
      return jsonResponse(res, 200, { ok: true, id, logs: cockpit.logsFor(id) });
    }

    if (req.method !== "POST") {
      return jsonResponse(res, 405, { ok: false, error: "method not allowed" });
    }

    if (action === "start") return jsonResponse(res, 200, await cockpit.start(id));
    if (action === "stop") return jsonResponse(res, 200, await cockpit.stop(id));
    if (action === "restart") return jsonResponse(res, 200, await cockpit.restart(id));
    if (action === "kill-port") return jsonResponse(res, 200, await cockpit.killPort(id));

    return false;
  };
}

class ProjectCockpit {
  private readonly roles: CockpitRole[];
  private readonly running = new Map<string, RunningProcess>();
  private readonly logs = new Map<string, LogEntry[]>();

  constructor(private readonly options: CockpitOptions) {
    this.roles = buildRoles(options);
    for (const role of this.roles) this.logs.set(role.id, []);
  }

  async profile() {
    return {
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
      roles: await this.rolesWithStatus(),
    };
  }

  async rolesWithStatus() {
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
    if (existing && !existing.child.killed && existing.child.exitCode === null) {
      return { ok: true, alreadyRunning: true, id: role.id, pid: existing.child.pid };
    }

    if (role.cwd) {
      try {
        await fs.access(role.cwd);
      } catch {
        this.append(role.id, "error", `Working directory does not exist: ${role.cwd}`);
        return { ok: false, error: `Working directory does not exist: ${role.cwd}` };
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
    if (!running || running.child.exitCode !== null) {
      return { ok: true, id: role.id, stopped: false, message: "No managed process is running." };
    }

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
    if (!role.port || role.allowKillPort === false) {
      return { ok: false, error: `${role.label} does not allow kill-port from the cockpit.` };
    }

    const port = await listeningPids(role.port);
    if (!port.listening || port.pids.length === 0) {
      return { ok: true, id: role.id, killed: [], message: `No listener on port ${role.port}.` };
    }

    const killed: number[] = [];
    for (const pid of port.pids) {
      try {
        process.kill(pid, "SIGTERM");
        killed.push(pid);
      } catch (error) {
        this.append(role.id, "error", `Failed to kill pid ${pid}: ${(error as Error).message}`);
      }
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

    return {
      kind: role.kind,
      disabled: role.kind === "placeholder",
      running: isRunning,
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
    {
      id: "spectra-gateway-current",
      label: "Spectra Gateway",
      group: "Core runtime",
      kind: "virtual",
      description: "The currently running gateway that serves this cockpit and the Focus AI bridge.",
      cwd: spectraDir,
      port: options.port,
      healthUrl: `http://${options.host}:${options.port}/api/v1/health`,
      allowKillPort: false,
    },
    {
      id: "focus-ui",
      label: "Focus UI",
      group: "Core runtime",
      kind: "managed-process",
      description: "Starts the Prism Focus browser app with a labelled, managed local server.",
      cwd: focusDir,
      command: "python3",
      args: ["-m", "http.server", "4173"],
      port: 4173,
      healthUrl: "http://127.0.0.1:4173/",
      allowKillPort: true,
    },
    {
      id: "spectra-validation",
      label: "Spectra Validation",
      group: "Validation",
      kind: "one-shot",
      description: "Runs the current low-noise Spectra checks for this bridge slice.",
      cwd: spectraDir,
      command: "bash",
      args: ["-lc", "npm run typecheck && npm run test:ai-request && npm run test:cockpit"],
    },
    {
      id: "spectra-git-state",
      label: "Spectra Git State",
      group: "Validation",
      kind: "one-shot",
      description: "Shows current Spectra branch, local status, and recent commits.",
      cwd: spectraDir,
      command: "bash",
      args: ["-lc", "printf 'branch: '; git branch --show-current; git status --short; git log --oneline -5"],
    },
    {
      id: "focus-git-state",
      label: "Focus Git State",
      group: "Validation",
      kind: "one-shot",
      description: "Shows current Focus branch, local status, and recent commits.",
      cwd: focusDir,
      command: "bash",
      args: ["-lc", "printf 'branch: '; git branch --show-current; git status --short; git log --oneline -5"],
    },
    {
      id: "ollama-status",
      label: "Ollama Status",
      group: "Local models",
      kind: "one-shot",
      description: "Lists installed and currently loaded Ollama models without launching real inference.",
      command: "bash",
      args: ["-lc", "ollama list && printf '\\n--- loaded models ---\\n' && ollama ps"],
    },
    {
      id: "vibe-coder-cli",
      label: "Vibe-Coder CLI",
      group: "Future interfaces",
      kind: "placeholder",
      description: "Reserved launch surface for a future vibe-coder CLI interface.",
      cwd: spectraDir,
      disabledReason: "Not built yet. This card locks the intended cockpit slot without pretending it is available.",
    },
    {
      id: "prism-build",
      label: "Prism Build",
      group: "Future interfaces",
      kind: "placeholder",
      description: "Reserved launch surface for a future Prism Build interface.",
      cwd: spectraDir,
      disabledReason: "Not built yet. Next step is to define safe build presets and review gates.",
    },
    {
      id: "beam-session-log",
      label: "Beam Session Log",
      group: "Reference layer",
      kind: "one-shot",
      description: "Read-only Beam orientation snapshot. Does not write progress logs.",
      cwd: beamDir,
      command: "bash",
      args: ["-lc", "printf 'branch: '; git branch --show-current; git status --short; printf '\\nRecent progress markers:\\n'; grep -n \"Focus\\|Spectra\\|cockpit\" AI_PROGRESS_LOG.md | tail -20 || true"],
    },
  ];
}

function commandPreview(role: CockpitRole) {
  if (!role.command) return role.disabledReason ?? "No command configured.";
  const env = role.env && Object.keys(role.env).length
    ? Object.entries(role.env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ") + " "
    : "";
  return `${env}${[role.command, ...(role.args ?? [])].map(shellWord).join(" ")}`;
}

function shellWord(value: string) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

async function listeningPids(port: number) {
  const result = await safeExec("lsof", ["-tiTCP:" + String(port), "-sTCP:LISTEN"], 2200);
  const pids = result.output.split(/\s+/).map(value => Number(value)).filter(Number.isFinite);
  return {
    ok: result.ok || pids.length === 0,
    port,
    listening: pids.length > 0,
    pids,
    error: result.ok ? undefined : result.error,
  };
}

async function quickHealth(url: string, token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const headers: Record<string, string> = {};
    if (url.includes("/api/v1/")) headers["x-local-token"] = token;
    const response = await fetch(url, { headers, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

async function exists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function safeExec(command: string, args: string[], timeout = 3000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, maxBuffer: 512 * 1024 });
    return {
      ok: true,
      output: String(stdout ?? "").trim(),
      error: String(stderr ?? "").trim() || undefined,
    };
  } catch (error) {
    const err = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer; code?: string | number };
    return {
      ok: false,
      output: String(err.stdout ?? "").trim(),
      error: String(err.stderr ?? "").trim() || err.message || String(err.code ?? "command failed"),
    };
  }
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
