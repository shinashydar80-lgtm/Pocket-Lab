const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const rateLimits = new Map();
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 30000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);

  if (pathname === "/api/chat" && req.method === "POST") {
    if (!GEMINI_API_KEY) {
      return sendJson(res, 503, { error: "AI chat is not configured yet. The site owner must add GEMINI_API_KEY in the server environment settings." });
    }

    const ip = req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = rateLimits.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 10 * 60 * 1000; }
    entry.count += 1;
    rateLimits.set(ip, entry);
    if (entry.count > 20) {
      return sendJson(res, 429, { error: "Too many messages in a short time. Please try again later." });
    }

    try {
      const body = await readBody(req);
      const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
      const contents = history
        .filter(item => item && ["user", "model"].includes(item.role) && Array.isArray(item.parts))
        .map(item => ({
          role: item.role,
          parts: item.parts.slice(0, 1).map(part => ({ text: String(part.text || "").slice(0, 2000) }))
        }))
        .filter(item => item.parts[0].text.trim());

      if (!contents.length || contents[contents.length - 1].role !== "user") {
        return sendJson(res, 400, { error: "Please enter a message first." });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      let apiResponse;
      try {
        apiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: "You are Pocket Lab AI, a helpful, clear, friendly assistant. Help users turn ideas into practical next steps and interactive project concepts. Keep answers age-appropriate. Never ask for passwords, private credentials, or sensitive personal information. Be honest about limitations." }]
              },
              contents,
              generationConfig: { temperature: 0.7, maxOutputTokens: 900 }
            }),
            signal: controller.signal
          }
        );
      } finally {
        clearTimeout(timeout);
      }

      const result = await apiResponse.json().catch(() => ({}));
      if (!apiResponse.ok) {
        const detail = result.error && result.error.message ? result.error.message : "The AI provider returned an error.";
        return sendJson(res, 502, { error: detail });
      }
      const reply = (result.candidates?.[0]?.content?.parts || [])
        .map(part => part.text || "")
        .join("")
        .trim();
      if (!reply) return sendJson(res, 502, { error: "The AI returned an empty response. Please try again." });
      return sendJson(res, 200, { reply });
    } catch (error) {
      const message = error.name === "AbortError"
        ? "The AI took too long to respond. Please try again."
        : (error.message || "Something went wrong.");
      return sendJson(res, 500, { error: message });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405); return res.end("Method not allowed");
  }

  let requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(ROOT, "." + requestedPath);
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403); return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const type = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pocket Lab running on port ${PORT}`);
});
