# ✦ Spark Code 1.2

**Terminal AI Coding Agent by [Spark Ai](https://sparkchat.live)**

Spark Code 1.2 is a powerful terminal-based AI coding agent that reads, writes, and builds code directly in your filesystem. It auto-routes every task to the best AI engine — GPT-5.3 Codex, Gemini, Grok, or DeepSeek — with no configuration needed.

---

## Install

```bash
npm install -g spark-code
```

Then run from any directory:

```bash
spark-code
# or shorthand:
spark
```

---

## Setup

Create a `.env` file in your project or home directory with your API keys:

```bash
# Required — OpenAI (GPT-5.3 Codex)
SPARKCODE_OPENAI_API_KEY=sk-...

# Optional — enables additional engines
GOOGLE_API_KEY=...        # Gemini
GROK_API_KEY=...          # Grok
DEEPSEEK_API_KEY=...      # DeepSeek

# Optional — save sessions & builds to Spark DB
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Auto-Routing

Spark Code 1.2 analyses your prompt and picks the right engine automatically:

| Task type | Engine |
|---|---|
| Algorithms, math, Rust / Go / C++ | DeepSeek |
| Bash scripts, quick one-liners, trending | Grok |
| Docs, README, large file analysis | Gemini |
| Everything else — React, TS, full apps, refactors | **GPT-5.3 Codex** (default) |

If one engine fails, Spark Code automatically falls back to the next available one.

---

## Commands

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/cd <path>` | Change working directory |
| `/ls [path]` | List directory |
| `/builds` | Show your saved builds from the Spark DB |
| `/history` | Show conversation history |
| `/clear` | Clear the screen |
| `/exit` or `q` | Exit |

Or just **type anything** and Spark Code will handle it.

---

## Examples

```
✦ ~/projects › build me a Next.js todo app with Tailwind and Supabase
✦ ~/projects › read package.json and tell me what's outdated
✦ ~/projects › add dark mode to my app
✦ ~/projects › write a binary search in Go
✦ ~/projects › /builds
```

---

## Database (optional)

Spark Code can log every session, message, and build to your Supabase database.  
Run `schema.sql` in your Supabase SQL Editor to create the required tables.

Tables created:
- `spark_agent_sessions` — every terminal session
- `spark_agent_messages` — full conversation logs
- `spark_agent_builds` — every file the agent created or modified

---

## Made by Spark Ai

[sparkchat.live](https://sparkchat.live)
