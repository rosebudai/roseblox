import { spawn } from "node:child_process";

/**
 * Serves the repository for one browser check on its own port. Resolves once this process has
 * bound the port and answers, so a check never talks to another check's (or worktree's) server.
 */
export async function serveRepository(root, port, timeoutMs = 10000) {
  const server = spawn("python3", ["-u", "-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  // A check that dies without reaching its finally must not leave the port held for the next run.
  process.once("exit", () => server.kill());
  let log = "", bound = false;
  server.stdout.on("data", chunk => { log += chunk; bound ||= log.includes("Serving HTTP"); });
  // Request logs go to stderr; keep draining it so the pipe never blocks the server.
  server.stderr.on("data", chunk => { if (!bound) log += chunk; });
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`Server on port ${port} exited (${server.exitCode}): ${log.trim().split("\n").at(-1)}`);
      if (bound && await fetch(`http://127.0.0.1:${port}/`).then(r => r.ok).catch(() => false)) return server;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Server on port ${port} was not ready within ${timeoutMs}ms.`);
  } catch (error) { server.kill(); throw error; }
}
