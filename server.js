const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json"
};

const server = http.createServer((req, res) => {
  let requestedPath = decodeURIComponent(req.url.split("?")[0]);

  if (requestedPath === "/") {
    requestedPath = "/index.html";
  }

  const filePath = path.join(ROOT, requestedPath);

  if (!filePath.startsWith(ROOT + path.sep) &&
      filePath !== path.join(ROOT, "index.html")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const type = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pocket Lab running on port ${PORT}`);
});
