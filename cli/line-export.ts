// CLI: bun run line-export — re-export the LINE_CHATS from LINE for Windows into LINE_DIR.
// Drives the LINE app (see scripts/line-export.ps1): don't touch the mouse/keyboard while it runs.
import { exportChats } from "../lib/line-export";
import { since } from "../lib/timesheet";

const t0 = Date.now();
const { chats } = await exportChats((text) => console.log(`[+${since(t0)}] ${text}`));
for (const r of chats) console.log(r.ok ? `✓ ${r.chat}: ${r.lines} lines` : `✗ ${r.chat}: ${r.error}`);
process.exit(chats.every((r) => r.ok) ? 0 : 1);
