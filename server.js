const express = require('express');
const path = require('path');

const app = express();
const PORT = 4032;

const socketIoClientPath = path.join(__dirname, 'api', 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js');

app.get('/vendor/socket.io.min.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(socketIoClientPath);
});

app.use(express.static(path.join(__dirname, 'client')));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self' https: http: data: blob:; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self' https: http: ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:");
    next();
  });