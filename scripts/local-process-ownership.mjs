import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function commandOutput(command, args, spawnSyncFn = spawnSync) {
  const result = spawnSyncFn(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result?.error || result?.status !== 0) return null;
  return String(result.stdout ?? "").trim();
}

export function parsePid(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
}

export function inspectProcess(
  pid,
  {
    spawnSyncFn = spawnSync,
    platform = process.platform,
    readlinkFn = readlinkSync,
  } = {},
) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;

  const startedAt = commandOutput("ps", ["-o", "lstart=", "-p", String(pid)], spawnSyncFn);
  const command = commandOutput("ps", ["-o", "command=", "-p", String(pid)], spawnSyncFn);
  if (!startedAt || command === null) return null;

  let cwd = null;
  const lsof = commandOutput(
    "lsof",
    ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
    spawnSyncFn,
  );
  if (lsof) {
    const line = lsof.split(/\r?\n/).find((entry) => entry.startsWith("n"));
    if (line?.length > 1) cwd = line.slice(1);
  }

  if (!cwd && platform === "linux") {
    try {
      cwd = readlinkFn(`/proc/${pid}/cwd`);
    } catch {
      // A missing/unreadable cwd means ownership cannot be proven.
    }
  }

  if (!cwd) return null;
  return { pid, startedAt, cwd: resolve(cwd), command };
}

export function processIsAlive(pid, { killFn = process.kill } = {}) {
  try {
    killFn(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export function createOwnershipRecord(identity, { kind, root, cwd }) {
  if (!identity?.pid || !identity?.startedAt) {
    throw new Error("cannot create local ownership record without a live process identity");
  }
  return {
    version: 1,
    kind,
    pid: identity.pid,
    startedAt: identity.startedAt,
    root: resolve(root),
    cwd: resolve(cwd),
  };
}

export function isOwnedProcessIdentity(
  record,
  identity,
  { kind, root, cwd, commandIncludes = null } = {},
) {
  if (!record || record.version !== 1 || record.kind !== kind) return false;
  if (!identity || record.pid !== identity.pid || record.startedAt !== identity.startedAt) {
    return false;
  }

  const expectedRoot = resolve(root);
  const expectedCwd = resolve(cwd);
  if (resolve(record.root) !== expectedRoot || resolve(record.cwd) !== expectedCwd) return false;
  if (resolve(identity.cwd) !== expectedCwd) return false;
  if (commandIncludes && !identity.command.includes(commandIncludes)) return false;
  return true;
}

export function readOwnershipRecord(path, { readFileFn = readFileSync } = {}) {
  try {
    const parsed = JSON.parse(readFileFn(path, "utf8"));
    if (
      parsed?.version !== 1 ||
      typeof parsed.kind !== "string" ||
      parsePid(parsed.pid) === null ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.root !== "string" ||
      typeof parsed.cwd !== "string"
    ) return null;
    return { ...parsed, pid: Number(parsed.pid) };
  } catch {
    return null;
  }
}

export function writeOwnershipRecord(
  path,
  record,
  { mkdirFn = mkdirSync, writeFileFn = writeFileSync } = {},
) {
  mkdirFn(dirname(path), { recursive: true });
  writeFileFn(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function removeOwnershipRecord(path, { rmFn = rmSync } = {}) {
  rmFn(path, { force: true });
}

function signalTarget(pid, group, platform) {
  return group && platform !== "win32" ? -pid : pid;
}

async function waitUntilOwnershipChanges(
  record,
  expected,
  {
    inspectFn = inspectProcess,
    sleepFn = sleep,
    attempts = 20,
    intervalMs = 100,
  } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = inspectFn(record.pid);
    if (!isOwnedProcessIdentity(record, current, expected)) return true;
    if (attempt + 1 < attempts) await sleepFn(intervalMs);
  }
  return false;
}

export async function stopOwnedProcess(
  record,
  {
    kind,
    root,
    cwd,
    commandIncludes = null,
    group = false,
    termSignal = "SIGTERM",
    killSignal = "SIGKILL",
    inspectFn = inspectProcess,
    isAliveFn = processIsAlive,
    killFn = process.kill,
    sleepFn = sleep,
    attempts = 20,
    killAttempts = 10,
    intervalMs = 100,
    platform = process.platform,
  } = {},
) {
  const expected = { kind, root, cwd, commandIncludes };
  const observed = inspectFn(record?.pid);

  if (!observed) {
    if (record?.pid && isAliveFn(record.pid)) {
      return { stopped: false, reason: "ownership-unproven" };
    }
    return { stopped: false, reason: "not-running" };
  }
  if (!isOwnedProcessIdentity(record, observed, expected)) {
    return { stopped: false, reason: "ownership-unproven" };
  }

  const target = signalTarget(record.pid, group, platform);
  try {
    killFn(target, termSignal);
  } catch (error) {
    if (error?.code === "ESRCH") return { stopped: true, reason: "stopped" };
    throw error;
  }

  if (await waitUntilOwnershipChanges(record, expected, {
    inspectFn,
    sleepFn,
    attempts,
    intervalMs,
  })) {
    return { stopped: true, reason: "stopped" };
  }

  const beforeKill = inspectFn(record.pid);
  if (!isOwnedProcessIdentity(record, beforeKill, expected)) {
    return { stopped: true, reason: "stopped" };
  }

  try {
    killFn(target, killSignal);
  } catch (error) {
    if (error?.code === "ESRCH") return { stopped: true, reason: "stopped" };
    throw error;
  }

  if (!(await waitUntilOwnershipChanges(record, expected, {
    inspectFn,
    sleepFn,
    attempts: killAttempts,
    intervalMs,
  }))) {
    throw new Error(`owned local ${kind} process ${record.pid} did not exit after ${killSignal}`);
  }
  return { stopped: true, reason: "stopped" };
}

export async function isPortAvailable(port, { host = "127.0.0.1" } = {}) {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        resolvePromise(false);
        return;
      }
      reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(true);
      });
    });
  });
}

export function foreignPortError(port) {
  return new Error(
    `local port ${port} is already in use by a process that is not proven to belong to this checkout; refusing to terminate it. Stop that listener yourself (for example, inspect it with lsof -nP -iTCP:${port} -sTCP:LISTEN) and retry.`,
  );
}

export async function requirePortsFree(
  ports,
  { portAvailableFn = isPortAvailable } = {},
) {
  for (const port of ports) {
    if (!(await portAvailableFn(port))) throw foreignPortError(port);
  }
}
