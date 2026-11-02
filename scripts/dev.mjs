// npm run dev (backend plan 15.1): the web app and the background worker together, so jobs run locally exactly as in
// production. Each line is prefixed with where it came from. Ctrl+C (or one of them exiting) stops both; the
// worker gets SIGTERM and finishes its running jobs first (JOB-07).
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const bin = (name) => path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

const processes = [
  { name: "web", command: bin("next"), args: ["dev", ...process.argv.slice(2)] },
  {
    name: "worker",
    command: bin("tsx"),
    // react-server: lets the server-only modules the worker shares with the app load outside Next.js.
    args: ["watch", "--conditions=react-server", "--env-file-if-exists=.env.local", "worker/index.ts"],
  },
];

let stopping = false;
const children = processes.map(({ name, command, args }) => {
  // shell: Windows runs the .cmd shims in node_modules/.bin only through a shell.
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop();
      for (const line of lines)
        (stream === child.stderr ? process.stderr : process.stdout).write(`[${name}] ${line}\n`);
    });
  }
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`[${name}] exited with code ${code}; stopping the others.`);
      stop(code ?? 1);
    }
  });
  return child;
});

function stop(code = 0) {
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  // JOB-07 gives running jobs 30 seconds; after that, leave anyway.
  setTimeout(() => process.exit(code), 31_000).unref();
  Promise.all(children.map((child) => (child.exitCode === null ? new Promise((r) => child.on("exit", r)) : null))).then(
    () => process.exit(code),
  );
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
