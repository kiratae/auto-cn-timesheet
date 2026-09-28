# auto-cn-timesheet

Drafts the day's ClickNext timesheet entries from LINE chats and GitLab commits. An LLM writes the entries, Jev picks the project and task type, and you review everything before it's posted.

## Setup

```sh
bun install
cp .env.example .env   # fill in the keys
```

LINE chat exports (`[LINE]<chat>.txt`) go in `LINE_DIR` (default `line_messages/`). You can save them by hand, or use **Refresh from LINE** / `bun run line-export`, which drives LINE for Windows.

## Run

| Command | What it does |
| --- | --- |
| `bun run dev` | Web UI at http://127.0.0.1:3939 |
| `bun run cli [--date YYYY-MM-DD] [--role Developer] [--yes]` | Same flow in the terminal |
| `bun run line-export` | Re-save the `LINE_CHATS` from LINE for Windows |
| `bun test` / `bun run typecheck` / `bun run lint` | Checks |

## Layout

```
app/            Next.js pages and API routes (day, propose, submit, line-export)
components/     UI (components/ui = shadcn)
lib/            rules.ts (shared, pure), timesheet.ts (server logic), line-export.ts, api.ts (browser client)
cli/            Bun CLIs: fill.ts, line-export.ts
scripts/        PowerShell UI automation for LINE (line-export.ps1; line-probe.ps1 for re-mapping after LINE updates)
docs/           Timesheet Open Dev API summary
```
