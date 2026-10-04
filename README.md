# EverCurrent Daily Digest

A local prototype that shows the same Slack threads producing a different daily digest when the **user**, **project**, **relationship**, or **focus** changes. See [DESIGN.md](DESIGN.md) for the specification, system diagram, architecture, and data flow.

The digest is a short ranked list of 5–7 key points. Each point carries an **Urgency** and a **Relevance** label and a **Source** link to the original thread.

## Quick start

Requires Node.js ≥ 22.13 (for the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env        # set GROQ_API_KEY
npm run dev                 # API on :3001, web app on http://127.0.0.1:5173
```

Production-style: `npm run build && npm start`, then open http://127.0.0.1:3001.

## How it works

1. **Changing a filter** only reads the SQLite cache. It never calls the LLM.
   - If a digest exists for the selected points, it shows immediately: `Cached · 0 LLM calls`.
   - Otherwise the page says `Not generated for these filters`.
2. **Run Digest** is the only way to reach the LLM. It runs two stages:
   - **Stage 1 — Thread analysis (LLM):** turns each Slack thread into structured key points.
     - Each thread without a cached brief gets one small Groq call (strict JSON, at most 3 points).
     - Briefs are cached by thread content hash, so each thread is analyzed only once.
   - **Stage 2 — Digest writing (LLM):** turns the most important points into a short digest for one user.
     - First, deterministic ranking rules (no LLM) filter the points, assign Urgency and Relevance, and select the top 6 open points plus at most one resolved point.
     - Then one small Groq call writes one sentence per selected point.
     - The digest is cached by user plus selected points, so different filters that select the same points share one digest.
3. Pressing **Run Digest** again on cached filters rewrites only the digest (one call).

The first run on a fresh database makes 19 calls: 18 threads plus 1 digest. Each new filter combination after that costs one call.

**Rate limits:** the server reads Groq's `x-ratelimit-*` headers and waits when the remaining token budget is below the next request's expected usage (the largest usage seen so far for that request type, plus 20%). On a 429 it waits and retries the same request, and the page shows `Waiting for rate limit · resumes in Ns`. If the wait is long or the quota is exhausted, the run stops. Briefs that were already finished stay cached, and the next Run Digest resumes from there.

**Validation:**

- Stage 1: citations must belong to the thread, and assignees and due dates must be stated in the cited messages.
- Stage 2: one `P<n> | sentence` line per point, with no new numbers.
- Both stages require English text.

Each stage gets one repair attempt. If the digest writer still fails, the digest shows the Stage 1 summaries labeled **Not AI-summarized**.

## Filters

| Filter       | Options                                                                                 |
| ------------ | --------------------------------------------------------------------------------------- |
| User         | Alex Chen (Mechanical Engineer), Sam Rivera (Supply Chain Lead)                         |
| Project      | All Projects, Robot Arm, Mobile Base                                                    |
| Relationship | Owner or Follower. Editable for a single project only; the default comes from the user. |
| Focus        | Design, Validation (testing, thermal, assembly), Supply (parts supply)                  |

## Configuration (`.env`)

| Variable        | Default                    | Notes                                            |
| --------------- | -------------------------- | ------------------------------------------------ |
| `GROQ_API_KEY`  | —                          | Server-side only. Never sent to the browser.     |
| `GROQ_MODEL`    | `openai/gpt-oss-20b`       | Must support strict `json_schema` output on Groq |
| `PORT`          | `3001`                     | Bound to 127.0.0.1                               |
| `DATABASE_PATH` | `.data/evercurrent.sqlite` | Briefs, digests, and the LLM call log            |

The model and prompt are not part of the cache keys. If you change either one, delete the SQLite file to regenerate.

## API

| Method | Path                 | Purpose                                                                                                                                                       |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/context`       | Date, cutoff, users, projects, LLM configuration                                                                                                              |
| `POST` | `/api/digest`        | `{filters, generate}`. With `false`: cache lookup (200). With `true`: start Run Digest (202). Returns 409 if a run is in progress, or 503 without an API key. |
| `GET`  | `/api/digest/status` | The current or last run: progress, waits, errors, LLM call count                                                                                              |
| `GET`  | `/api/threads/:id`   | The thread behind a Source link                                                                                                                               |

## Tests and evaluation

```bash
npm test            # rules (including the single-filter-change check over all 30 combinations), validators, service, API
npm run test:e2e    # Playwright against the real app with a deterministic test LLM: no key, no Groq calls
npm run check       # format check + typecheck + unit tests + build
npm run format      # format the repository with Prettier
npm run evaluate    # compare the cached model briefs with fixtures/reference-briefs.json
```

- Run `npx playwright install chromium` once before the e2e tests. To use an existing browser, set `PLAYWRIGHT_CHROMIUM_PATH`.
- `fixtures/reference-briefs.json` holds handwritten reference points, not model output. They feed the rule tests and the test LLM, and `npm run evaluate` compares real model output against them.
- `evaluate` fails only on objective errors that change what the user sees: wrong assignees, wrong due dates, missed blockers, or wrong resolved state. Other label differences are judgment calls and are listed as notes. It never edits model output, and valid citations do not prove that a summary is accurate.

## Layout

```
src/domain/            pure rules and shared types: schema, rank, validate, evaluate, API contracts
src/server/http/       Express routes
src/server/digest/     Run Digest pipeline: service, thread analyzer, digest writer, cache query, cache keys
src/server/llm/        LLM interface, Groq client, rate-limit-aware caller, prompts
src/server/storage/    storage interfaces and the SQLite implementation
src/server/server.ts   composition root (wires Groq and SQLite into the pipeline)
src/web/               React UI: filters, digest list, source drawer
fixtures/     dataset (18 synthetic threads) and reference briefs
tests/        Vitest suites, test LLM, Playwright e2e
```

This is a local demo on synthetic data with no authentication. Slack text is treated as untrusted input.
