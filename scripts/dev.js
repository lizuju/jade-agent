import { spawn } from "node:child_process";

const commands = [
  ["api", "node", ["--watch", "server/index.js"]],
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
