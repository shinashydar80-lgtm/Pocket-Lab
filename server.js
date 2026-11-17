
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const MAX_RETRIES = 2;
const REQUEST_TIMEOUT = 30000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const rateLimits = new Map();

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
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
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function askGemini(contents) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const payload = {
    systemInstruction: {
      parts: [{
        text: "You are Pocket Lab AI, a helpful, clear and friendly assistant. Help users turn ideas into practical next steps and interactive project concepts. Keep answers age-appropriate. Never ask for passwords, private credentials or sensitive personal information. Be honest about limitations."
      }]
    },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 900
    }
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    );

    let response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      console.error("Gemini network error:", {
        name: error.name,
        message: error.message,
        attempt: attempt + 1
      });

      if (attempt < MAX_RETRIES &&
          (error.name === "AbortError" ||
           error.name === "TypeError")) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const result = await response.json().catch(() => ({}));

    if (response.ok) {
      const reply = (
        result.candidates?.[0]?.content?.parts || []
      )
        .map(part => part.text || "")
        .join("")
        .trim();

      if (!reply) {
        console.error("Gemini returned an empty response.");
        throw new Error("The AI returned an empty response.");
      }

      return reply;
    }

    console.error("Gemini API Error:", {
      status: response.status,
      statusText: response.statusText,
      details: result.error || result,
      attempt: attempt + 1
    });

    const temporaryError =
      response.status === 429 ||
      response.status === 500 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504;

    if (temporaryError && attempt < MAX_RETRIES) {
      await sleep(1500 * (attempt + 1));
      continue;
    }

    const error = new Error(
      result.error?.message ||
      "The AI provider returned an error."
    );

    error.status = response.status;
    throw error;
  }

  throw new Error("AI request failed after retries.");
}

const server = http.createServer(async (req, res) => {
  let pathname;

  try {
    pathname = decodeURIComponent(
      (req.url || "/").split("?")[0]
    );
  } catch {
    return sendJson(res, 400, {
      error: "Invalid URL."
    });
  }

  if (pathname === "/api/chat" && req.method === "POST") {

    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is missing.");

      return sendJson(res, 503, {
        error: "AI chat is not configured. Please contact the site owner."
      });
    }

    const ip = req.socket.remoteAddress || "unknown";
    const now = Date.now();

    const entry = rateLimits.get(ip) || {
      count: 0,
      resetAt: now + 10 * 60 * 1000
    };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + 10 * 60 * 1000;
    }

    entry.count++;
    rateLimits.set(ip, entry);

    if (entry.count > 20) {
      return sendJson(res, 429, {
        error: "Too many messages. Please try again later."
      });
    }

    try {
      const body = await readBody(req);

      const history = Array.isArray(body.history)
        ? body.history.slice(-12)
        : [];

      const contents = history
        .filter(item =>
          item &&
          ["user", "model"].includes(item.role) &&
          Array.isArray(item.parts)
        )
        .map(item => ({
          role: item.role,
          parts: item.parts
            .slice(0, 1)
            .map(part => ({
              text: String(part.text || "").slice(0, 2000)
            }))
        }))
        .filter(item => item.parts[0].text.trim());

      if (
        !contents.length ||
        contents[contents.length - 1].role !== "user"
      ) {
        return sendJson(res, 400, {
          error: "Please enter a message first."
        });
      }

      const reply = await askGemini(contents);

      return sendJson(res, 200, { reply });

    } catch (error) {
      console.error("Pocket Lab Server Error:", {
        name: error.name,
        message: error.message,
        status: error.status || null
      });

      let message;

      if (error.name === "AbortError") {
        message = "The AI took too long to respond. Please try again.";
      } else if (error.status === 429 ||
                 error.status === 503 ||
                 error.status === 500 ||
                 error.status === 502 ||
                 error.status === 504) {
        message = "The AI service is temporarily busy. Please try again later.";
      } else {
        message = error.message || "Something went wrong.";
      }

      return sendJson(res, error.status === 400 ? 400 : 502, {
        error: message
      });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end("Method not allowed");
  }

  const requestedPath =
    pathname === "/" ? "/index.html" : pathname;

  const filePath = path.resolve(ROOT, "." + requestedPath);

  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const type =
      mimeTypes[path.extname(filePath)] ||
      "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": type
    });

    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Pocket Lab running on port " + PORT);
  console.log("Gemini model configured:", GEMINI_MODEL);
});
