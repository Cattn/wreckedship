const express = require('express');
const path = require('path');

const app = express();
const PORT = 4032;

app.use(express.static(path.join(__dirname, 'client')));

app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' https: data: blob: 'unsafe-inline'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self' https: wss: http:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'"
    );
    next();
  });

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
