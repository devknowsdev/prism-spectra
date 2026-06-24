import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MemoryDB } from "../../src/index.js";
import { SANDBOX_TMP_DIR, seedSandboxTmp } from "../../sandbox/scripts/sandbox-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".test-tmp");
const REPO_ROOT = path.join(__dirname, "..", "..");
const DAEMON_SCRIPT = path.join(REPO_ROOT, "tools", "daemon.ts");
const TSX_LOADER = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type CdpEventHandler = (params: any) => void;

class SmokeSkip extends Error {}

class CdpClient {
  private readonly ws: WebSocket;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>();
  private readonly listeners = new Map<string, CdpEventHandler[]>();
  private nextId = 1;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener("message", (event) => this.onMessage(String(event.data)));
  }

  async ready(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", (event) => reject(new Error(`WebSocket error connecting to ${this.url}`)), { once: true });
    });
  }

  private get url(): string {
    return (this.ws as unknown as { url?: string }).url || "browser websocket";
  }

  private onMessage(payload: string): void {
    const message = JSON.parse(payload) as { id?: number; result?: any; error?: { message?: string }; method?: string; params?: any };
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "CDP command failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      for (const handler of this.listeners.get(message.method) || []) {
        handler(message.params);
      }
    }
  }

  on(method: string, handler: CdpEventHandler): () => void {
    const handlers = this.listeners.get(method) ?? [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
    return () => {
      const nextHandlers = (this.listeners.get(method) ?? []).filter((item) => item !== handler);
      if (nextHandlers.length === 0) {
        this.listeners.delete(method);
      } else {
        this.listeners.set(method, nextHandlers);
      }
    };
  }

  once(method: string): Promise<any> {
    return new Promise((resolve) => {
      const off = this.on(method, (params) => {
        off();
        resolve(params);
      });
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
      await new Promise<void>((resolve) => {
        this.ws.addEventListener("close", () => resolve(), { once: true });
        setTimeout(resolve, 1500);
      });
    }
  }
}

function findChromeExecutable(): string {
  if (fs.existsSync(CHROME_PATH)) {
    return CHROME_PATH;
  }

  throw new Error(`Unable to find Google Chrome at ${CHROME_PATH}.`);
}

async function waitForJson(url: string, predicate: (value: any) => boolean, timeoutMs = 10_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = await response.json();
        if (predicate(value)) {
          return value;
        }
      }
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForExpr(client: CdpClient, expression: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send("Runtime.evaluate", {
      expression: `Boolean(${expression})`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result?.result?.value === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function evalByValue<T>(client: CdpClient, expression: string): Promise<T> {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.value as T;
}

function findButtonClickScript(text: string): string {
  return `(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const button = buttons.find((item) => (item.textContent || '').includes(${JSON.stringify(text)}));
    if (!(button instanceof HTMLElement)) {
      throw new Error('button not found: ${text}');
    }
    button.click();
    return true;
  })()`;
}

function buildAttachmentSeed(cwd: string): { attachmentId: number; attachmentName: string } {
  const dbPath = path.join(cwd, ".demo", "daemon.db");
  const uploadsDir = path.join(cwd, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const sandboxTextPath = path.join(SANDBOX_TMP_DIR, "attachments", "text-attachment.txt");
  const attachmentName = "browser-smoke.txt";
  const attachmentPath = path.join(uploadsDir, attachmentName);
  fs.copyFileSync(sandboxTextPath, attachmentPath);
  const bytes = fs.readFileSync(attachmentPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const db = new MemoryDB(dbPath);
  db.db.prepare("INSERT INTO conversations (title, metadata) VALUES (?, ?)").run("Browser smoke conversation", JSON.stringify({ source: "sandbox" }));
  const conversationRow = db.db.prepare("SELECT id FROM conversations ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
  const conversationId = Number(conversationRow.id);
  const result = db.db.prepare(
    "INSERT INTO attachments (conversation_id, filename, path, content_type, size, sha256) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(conversationId, attachmentName, attachmentPath, "text/plain", bytes.byteLength, sha256);
  const attachmentId = Number(result.lastInsertRowid);
  db.close();

  return { attachmentId, attachmentName };
}

async function startDaemon(cwd: string, port: number): Promise<{ stop: () => Promise<void>; log: () => string }> {
  const token = `browser-smoke-${Date.now()}`;
  const daemon = spawn(process.execPath, ["--import", pathToFileURL(TSX_LOADER).href, DAEMON_SCRIPT], {
    cwd,
    env: {
      ...process.env,
      AI_FORGE_DAEMON_PORT: String(port),
      AI_FORGE_DAEMON_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let bindBlocked = false;
  daemon.stdout.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    if (/listen EPERM|operation not permitted/i.test(text)) {
      bindBlocked = true;
    }
  });
  daemon.stderr.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    if (/listen EPERM|operation not permitted/i.test(text)) {
      bindBlocked = true;
    }
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (bindBlocked) {
      throw new SmokeSkip("browser smoke skipped: socket bind is not permitted in this environment");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/workbench`);
      if (response.ok) {
        const html = await response.text();
        if (html.includes("Spectra Workbench")) {
          return {
            stop: async () => {
              daemon.kill();
              await new Promise<void>((resolve) => {
                daemon.once("exit", () => resolve());
                setTimeout(resolve, 1500);
              });
            },
            log: () => output,
          };
        }
      }
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  daemon.kill();
  throw new Error(`Daemon did not start:\n${output.slice(0, 4000)}`);
}

async function startChrome(debugPort: number, userDataDir: string): Promise<{ stop: () => Promise<void> }> {
  const chrome = spawn(findChromeExecutable(), [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  chrome.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  chrome.stderr.on("data", (chunk) => {
    output += String(chunk);
  });

  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, (value) => typeof value?.webSocketDebuggerUrl === "string");

  return {
    stop: async () => {
      chrome.kill();
      await new Promise<void>((resolve) => {
        chrome.once("exit", () => resolve());
        setTimeout(resolve, 1500);
      });
    },
  };
}

async function connectToChromePage(debugPort: number): Promise<CdpClient> {
  const pages = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`, (value) => Array.isArray(value) && value.some((entry) => entry.type === "page"));
  const pageTarget = pages.find((entry: Record<string, unknown>) => entry.type === "page" && typeof entry.webSocketDebuggerUrl === "string");
  if (!pageTarget) {
    throw new Error("No Chrome page target was available.");
  }
  const client = new CdpClient(String(pageTarget.webSocketDebuggerUrl));
  await client.ready();
  return client;
}

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  seedSandboxTmp();

  const browserTempRoot = fs.mkdtempSync(path.join(ROOT, "browser-workbench-"));
  const daemonPort = 32800 + Math.floor(Math.random() * 1000);
  const chromePort = 35800 + Math.floor(Math.random() * 1000);

  buildAttachmentSeed(browserTempRoot);
  const daemon = await startDaemon(browserTempRoot, daemonPort);
  const chrome = await startChrome(chromePort, path.join(browserTempRoot, "chrome-profile"));

  try {
    const client = await connectToChromePage(chromePort);
    const previewRequests: string[] = [];
    client.on("Network.requestWillBeSent", (params) => {
      const url = String(params?.request?.url || "");
      if (url.includes("/api/v1/workbench/attachments/") && url.includes("/preview")) {
        previewRequests.push(url);
      }
    });

    await client.send("Network.enable");
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    const loadEvent = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: `http://127.0.0.1:${daemonPort}/workbench` });
    await loadEvent;
    await waitForExpr(client, `document.title.includes("Spectra Workbench")`);
    await waitForExpr(client, `Array.from(document.querySelectorAll('button[data-view="attachments"]')).some((button) => (button.textContent || '').includes("Attachments"))`);

    await client.send("Runtime.evaluate", { expression: findButtonClickScript("Attachments") });
    await waitForExpr(client, `document.querySelector('[data-section="attachments"]')?.classList.contains("active")`);
    await waitForExpr(client, `Array.from(document.querySelectorAll('button[data-attachment-id]')).some((button) => (button.textContent || '').includes("browser-smoke.txt"))`);
    await client.send("Runtime.evaluate", { expression: findButtonClickScript("browser-smoke.txt") });

    await waitForExpr(client, `document.getElementById("attachment-detail")?.innerText.includes("Text preview pending")`);
    await waitForExpr(client, `document.getElementById("attachment-detail")?.innerText.includes("browser-smoke.txt")`);

    const previewButtonCount = await evalByValue<number>(client, `document.querySelectorAll('button[data-attachment-action="audio-preview-load"]').length`);
    const autoplayMediaCount = await evalByValue<number>(client, `document.querySelectorAll('audio[autoplay], video[autoplay]').length`);
    const boundaryReminderVisible = await evalByValue<boolean>(client, `
      (() => {
        const items = Array.from(document.querySelectorAll(".placeholder-line"));
        return items.some((item) => (item.textContent || "").includes("Local-only boundary reminder:"));
      })()
    `);

    assert.equal(previewRequests.length, 0, "attachment selection should not eagerly request preview bytes");
    assert.equal(previewButtonCount, 0, "text attachments should not show a waveform button");
    assert.equal(autoplayMediaCount, 0, "no autoplay media should be present");
    assert.equal(boundaryReminderVisible, true, "the local-only reminder should stay visible");
    assert.ok(await evalByValue<boolean>(client, `document.body.innerText.includes("Attachments")`));
    assert.ok(await evalByValue<boolean>(client, `document.body.innerText.includes("browser-smoke.txt")`));
    await client.close();
  } finally {
    await chrome.stop().catch(() => {});
    await daemon.stop().catch(() => {});
  }
}

main().catch((error) => {
  if (error instanceof SmokeSkip) {
    console.log(`skip - ${error.message}`);
    process.exitCode = 0;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
