import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
  const fsPath = join(ROOT, cleanPath.replace(/^\/+/, ''));

  try {
    const fileStat = await stat(fsPath);
    if (fileStat.isDirectory()) {
      throw new Error('Is directory');
    }
    const data = await readFile(fsPath);
    const ext = extname(fsPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch (err) {
    try {
      const index = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(index);
    } catch (innerErr) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`Crowd simulator server listening on http://localhost:${PORT}`);
});
