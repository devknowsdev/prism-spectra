import { createReadStream, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(__dirname, '../../..', 'EPK', 'EPK', 'public');
const port = Number(process.env.PORT || 8123);

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

try {
  const rootStat = statSync(publicRoot);
  if (!rootStat.isDirectory()) {
    throw new Error(`${publicRoot} is not a directory`);
  }
} catch (error) {
  console.error(`Cannot serve EPK public root: ${error.message}`);
  process.exit(1);
}

function resolveRequestPath(url) {
  const pathname = new URL(url, `http://127.0.0.1:${port}`).pathname;
  const decoded = decodeURIComponent(pathname);
  const relativePath = normalize(decoded).replace(/^([/\\])+/, '');
  const requestedPath = resolve(publicRoot, relativePath || 'index.html');

  if (requestedPath !== publicRoot && !requestedPath.startsWith(publicRoot + sep)) {
    return null;
  }

  return requestedPath;
}

const server = createServer(async (request, response) => {
  if (!request.url || request.method !== 'GET') {
    response.writeHead(405).end('Method not allowed');
    return;
  }

  const requestedPath = resolveRequestPath(request.url);
  if (!requestedPath) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(requestedPath);
    const filePath = fileStat.isDirectory() ? join(requestedPath, 'index.html') : requestedPath;
    const contentType = mimeTypes.get(extname(filePath)) || 'application/octet-stream';

    response.writeHead(200, { 'content-type': contentType });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${publicRoot} at http://127.0.0.1:${port}`);
});
