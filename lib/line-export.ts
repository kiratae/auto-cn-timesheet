// Re-export the configured LINE chats by driving LINE for Windows (scripts/line-export.ps1).
// Used by app/api/line-export (the "Refresh from LINE" button) and cli/line-export.ts.
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChatExport } from "./rules";
import { clearDayCache } from "./timesheet";

export type ExportResult = { chats: ChatExport[]; cancelled: boolean };

// One run at a time: the script takes over the mouse and LINE's windows.
// `controlling` flips once the script announces "Taking control now." — after that, cancelling is too late.
let current: { cancelFile: string; controlling: boolean } | null = null;
export const isExportRunning = () => current !== null;

// Cancel only works during the 3 s countdown. The script itself checks for the cancel file between ticks,
// so it stops cleanly instead of being killed halfway through operating LINE.
export function requestCancel(): "requested" | "too-late" | "not-running" {
  if (!current) return "not-running";
  if (current.controlling) return "too-late";
  writeFileSync(current.cancelFile, "");
  return "requested";
}

export const lineChats = () =>
  (process.env.LINE_CHATS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export async function exportChats(onProgress: (text: string) => void): Promise<ExportResult> {
  if (process.platform !== "win32") throw new Error("LINE export needs LINE for Windows");
  if (current) throw new Error("A LINE export is already running");
  const chats = lineChats();
  if (!chats.length) throw new Error("Set LINE_CHATS in .env (comma-separated chat names, as shown in LINE)");
  const run = { cancelFile: join(tmpdir(), `line-export-cancel-${process.pid}-${Date.now()}`), controlling: false };
  current = run;
  try {
    return await new Promise<ExportResult>((done, fail) => {
      const script = resolve(/*turbopackIgnore: true*/ "scripts", "line-export.ps1");
      const outDir = resolve(/*turbopackIgnore: true*/ process.env.LINE_DIR || ".");
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-OutDir", outDir, "-CancelFile", run.cancelFile],
        {
          // Names go through the environment as JSON: no quoting trouble with Thai, emoji or spaces.
          env: { ...process.env, LINE_CHATS_JSON: JSON.stringify(chats) },
          windowsHide: true,
        },
      );
      let buf = "";
      let stderr = "";
      let result: ExportResult | undefined;
      let error: string | undefined;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.progress) {
              if (msg.progress === "Taking control now.") run.controlling = true;
              onProgress(msg.progress);
            } else if (msg.result) result = { chats: msg.result.chats ?? [], cancelled: msg.result.cancelled === true };
            else if (msg.error) error = msg.error;
          } catch {
            onProgress(line); // stray PowerShell output; show it rather than lose it
          }
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d: string) => (stderr += d));
      child.on("error", fail);
      child.on("close", (code) => {
        if (error) fail(new Error(error));
        else if (result) done(result);
        else fail(new Error(`LINE export exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ""}`));
      });
    });
  } finally {
    current = null;
    rmSync(run.cancelFile, { force: true });
    clearDayCache(); // the next day load reads the new files
  }
}
