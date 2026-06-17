import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const commands = [
  ["api", existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3", ["-u", "-m", "backend.app"]],
  ["web", "vite", ["--host", "127.0.0.1"]]
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: true });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code) => {
    if (code) process.exitCode = code;
  });
  return child;
});

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
