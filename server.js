const express = require('express');
const path = require('path');

const app = express();
const PORT = 4031;

app.use(express.static(path.join(__dirname, 'client')));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
