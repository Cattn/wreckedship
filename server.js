const express = require('express');
const path = require('path');

const app = express();
const PORT = 4032;

app.use(express.static(path.join(__dirname, 'client')));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self' https: http: data: blob:; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self' https: http: ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:");
    next();
  });