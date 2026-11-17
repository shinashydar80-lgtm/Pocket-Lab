# Pocket-Lab
Pocket Lab is an AI-powered platform that transforms everyday ideas and problems into interactive, useful experiences. Your idea. Made useful.

## Run
Requires Node.js 18 or newer.

```bash
npm start
```

## Enable AI chat
The AI chat requires a Gemini API key. Add it as a server-side environment variable named `GEMINI_API_KEY` in your hosting provider. Do not put the key in `index.html` or commit it to GitHub.

The server uses `gemini-2.5-flash` by default. You can optionally set `GEMINI_MODEL` as another environment variable.

If no API key is configured, the website and sample idea builder still load, but AI chat will show a setup message. The site owner should set usage limits and monitor API usage. If the owner is under 18, a trusted adult should manage any account or billing.
