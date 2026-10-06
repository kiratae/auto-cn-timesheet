// Compiled to "Timesheet Autofill.exe" (bun run exe): builds if needed, starts the server hidden,
// opens it in an Edge app window, and stops the server when that window closes.
import { existsSync, openSync } from "node:fs";
import { dirname, join } from "node:path";

const URL = "http://127.0.0.1:3939";
// ponytail: hardcoded Edge path, look it up in the registry if it ever moves
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const root = dirname(process.execPath);
const env = { ...process.env, PATH: `${process.env.USERPROFILE}\\.bun\\bin;${process.env.PATH}` };
const log = openSync(join(root, "launcher.log"), "w");
const run = (cmd: string[]) => Bun.spawn(cmd, { cwd: root, env, stdout: log, stderr: log, windowsHide: true });
const up = () => fetch(URL).then(() => true, () => false);

let server: ReturnType<typeof run> | undefined;
if (!(await up())) {
  if (!existsSync(join(root, ".next", "BUILD_ID")) && (await run(["bun", "run", "build"]).exited) !== 0) process.exit(1);
  server = run(["bun", "start"]);
  const deadline = Date.now() + 60_000;
  while (!(await up())) {
    if (Date.now() > deadline || server.exitCode !== null) stop(1);
    await Bun.sleep(300);
  }
}

// Own profile so this Edge process lives as long as the window instead of handing off to a running Edge.
await Bun.spawn([EDGE, `--app=${URL}`, `--user-data-dir=${join(root, ".edge-app")}`]).exited;
stop(0);

function stop(code: number): never {
  // /T: bun start spawns next as a child
  if (server) Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(server.pid)], { windowsHide: true });
  process.exit(code);
}
