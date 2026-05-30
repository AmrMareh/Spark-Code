# ✦ Okran Code 1.3

**Terminal AI Coding Agent by Okran Ai**

Okran Code 1.3 is a powerful terminal-based AI coding agent that reads, writes, and builds code directly in your filesystem. It auto-routes every task to the best AI engine — GPT-5.3 Codex, Gemini, Grok, or DeepSeek — with no configuration needed.

---

## Install

```bash
npm install -g okran-code
```

Then run from any directory:

```bash
okran-code
# or shorthand:
okran
```

---

## Setup

Create a `.env` file in your project or `~/.okran-code/.env` with your API keys:

```bash
# Required — OpenAI (GPT-5.3 Codex)
OKRANCODE_OPENAI_API_KEY=sk-...

# Optional — enables additional engines
GOOGLE_API_KEY=...        # Gemini
GROK_API_KEY=...          # Grok
DEEPSEEK_API_KEY=...      # DeepSeek

# Optional — save sessions & builds to Okran DB
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Auto-Routing

Okran Code 1.3 analyses your prompt and picks the right engine automatically:

| Task type | Engine |
|---|---|
| Algorithms, math, Rust / Go / C++ | DeepSeek |
| Bash scripts, quick one-liners, trending | Grok |
| Docs, README, large file analysis | Gemini |
| Everything else — React, TS, full apps, refactors | **GPT-5.3 Codex** (default) |

If one engine fails, Okran Code automatically falls back to the next available one.

---

## Commands

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/cd <path>` | Change working directory |
| `/ls [path]` | List directory |
| `/open <file>` | Open a file in your editor or default app |
| `/run <file>` | Run a script directly (.js .ts .py .sh .rb) |
| `/builds` | Show your saved builds from Okran DB |
| `/history` | Show conversation history |
| `/clear` | Clear the screen |
| `/exit` or `q` | Exit |

Or just **type anything** and Okran Code will handle it.

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

Okran Code can log every session, message, and build to your Supabase database.  
Run `schema.sql` in your Supabase SQL Editor to create the required tables.

Tables created:
- `spark_agent_sessions` — every terminal session
- `spark_agent_messages` — full conversation logs
- `spark_agent_builds` — every file the agent created or modified

---

## Made by Okran Ai
