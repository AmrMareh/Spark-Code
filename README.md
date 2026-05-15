# ✦ Spark Agent

A Claude Code-style **terminal AI coding agent** built on the Spark platform.  
Connected to the **same Supabase database** as Spark.Ai — every session and build is recorded.

---

## Quick start

```bash
cd /Users/amrmareh/Desktop/Spark-Code
npm install
node index.js
```

Or install globally so you can run `spark` from anywhere:

```bash
npm install -g .
spark
```

## Before first run

### 1 — Add your Anthropic API key

Open `.env` and paste your Claude API key:

```
SPARKCODE_ANTHROPIC_API_KEY=sk-ant-...
```

Get one at https://console.anthropic.com/

### 2 — Run the database schema

In **Supabase → SQL Editor** (https://dnnbnwsqcixcwhrbohwn.supabase.co), paste and run `schema.sql`.  
This creates three new tables:

| Table | What it stores |
|---|---|
| `spark_agent_sessions` | Every terminal session (start time, model, duration) |
| `spark_agent_messages` | Full conversation log per session |
| `spark_agent_builds` | Every time the agent creates or modifies files |

Two views let you browse data easily in the Supabase Studio Table Editor:

| View | Shows |
|---|---|
| `spark_agent_build_summary` | All builds with user email, file counts, AI model used |
| `spark_agent_session_summary` | All sessions with duration and message count |

---

## Commands

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/model <name>` | Switch AI model (`claude` · `gpt` · `gemini` · `grok` · `deepseek`) |
| `/cd <path>` | Change working directory |
| `/ls [path]` | List directory |
| `/builds` | Show your builds from the Spark DB |
| `/history` | Show conversation history |
| `/clear` | Clear screen |
| `/exit` or `q` | Exit |

Or just **type anything** and the agent will figure out what to do.

---

## Examples

```
✦ ~/projects › build me a Next.js todo app with Tailwind and Supabase
✦ ~/projects › read package.json and tell me what's outdated
✦ ~/projects › add dark mode to my app
✦ ~/projects › /model gpt
✦ ~/projects › /builds
```

---

## AI Models

| Key | Model | Provider |
|---|---|---|
| `claude` | Claude 4 Sonnet (default) | Anthropic |
| `gpt` | GPT-4o | OpenAI |
| `gemini` | Gemini 2.0 Flash | Google |
| `grok` | Grok 3 | xAI |
| `deepseek` | DeepSeek Chat | DeepSeek |

If a model fails the agent auto-falls-back to Claude.

---

## CLI flag

```bash
spark --model=gpt
```
