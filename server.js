// server.js
// Phase 1 (v2): Browser terminal backend.
// Now serves the frontend (public/index.html) directly, so the whole
// thing works from ONE single URL — no separate local file needed.
//
// NOTE: This is Phase 1 only (no Docker isolation, no auth, no multi-user
// separation). Anyone who opens this URL gets a real shell on this server.
// Fine for testing, not for public/production use yet.

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const pty = require('node-pty');
const os = require('os');

const PORT = process.env.PORT || 3000;

// Pick the right default shell for the OS this server runs on.
const shellCmd = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

const PUBLIC_DIR = path.join(__dirname, 'public');

// Basic HTTP server: serves the frontend file(s) from /public.
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const contentType = ext === '.html' ? 'text/html' : 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('[server] New client connected. Spawning shell:', shellCmd);

  // Spawn a real pseudo-terminal (pty) running the shell.
  const ptyProcess = pty.spawn(shellCmd, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || process.cwd(),
    env: process.env
  });

  // Shell -> Browser: whenever the shell prints anything, send it to the client.
  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log('[server] Shell process exited with code', exitCode);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', exitCode }));
      ws.close();
    }
  });

  // Browser -> Shell: whenever the client sends a message, feed it to the shell.
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.type === 'input') {
        ptyProcess.write(msg.data);
      } else if (msg.type === 'resize') {
        ptyProcess.resize(msg.cols, msg.rows);
      }
    } catch (err) {
      console.error('[server] Failed to parse client message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[server] Client disconnected. Killing shell process.');
    ptyProcess.kill();
  });

  ws.on('error', (err) => {
    console.error('[server] WebSocket error:', err);
  });
});

server.listen(PORT, () => {
  console.log(`[server] Terminal app listening on port ${PORT}`);
});
