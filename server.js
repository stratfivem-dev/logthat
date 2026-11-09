// Tiny static file server so this site can also run on Node.js hosting.
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILES = {
  'index.html': 'text/html; charset=utf-8',
  'sw.js': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'manifest.json': 'application/manifest+json',
  'favicon.ico': 'image/x-icon',
  'favicon-32.png': 'image/png',
  'icon-192.png': 'image/png',
  'icon-512.png': 'image/png',
  'icon-maskable-512.png': 'image/png',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let name = url.replace(/^\/+/, '');
    // Any path without a file extension (/, /health, /anything) serves the app,
    // so health checks and refreshes always get a 200.
    if (!name || !path.extname(name)) name = 'index.html';
    const type = FILES[name];
    if (!type) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    fs.readFile(path.join(__dirname, name), (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Server error');
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': name === 'sw.js' || name === 'index.html' ? 'no-cache' : 'public, max-age=86400',
      });
      if (req.method === 'HEAD') return res.end();
      res.end(data);
    });
  })
  .listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Listening on ' + (process.env.PORT || 3000)));
