// Shared CLI plumbing: locating installed provider CLIs (Electron apps
// launched from Finder do not inherit the shell PATH) and running them.
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const { existsSync } = require("fs");
const { delimiter, join } = require("path");
const { REQUEST_TIMEOUT_MS, cliKnownDirectories } = require("./config");

const execFileAsync = promisify(execFile);

function resolveCli(name) {
  const executableNames = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const pathDirectories = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const directory of [...new Set([...pathDirectories, ...cliKnownDirectories()])]) {
    for (const executableName of executableNames) {
      const candidate = join(directory, executableName);
      if (existsSync(candidate)) return candidate;
    }
  }
  return name;
}

function isWindowsCommandScript(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

// spawn's shell:true mode on Windows joins the command and args into one string
// without quoting, so cmd.exe splits on any space in the path (e.g. "C:\Program
// Files\...") or in an argument. Quote anything that needs it before that join.
function quoteForWindowsShell(value) {
  const stringValue = String(value);
  if (stringValue !== "" && !/[\s"^&|<>()%!]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function runCli(command, args, { timeout: timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const executable = resolveCli(command);
  const options = {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1_000_000,
  };
  if (!isWindowsCommandScript(executable)) return execFileAsync(executable, args, options);

  // npm installs Windows CLIs as .cmd files. Node cannot execFile those wrappers,
  // so run them through cmd.exe while preserving their stdout for JSON responses.
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const processHandle = spawn(
      quoteForWindowsShell(executable),
      args.map(quoteForWindowsShell),
      { shell: true, windowsHide: true },
    );
    const timeout = setTimeout(() => {
      processHandle.kill();
      const error = new Error(`${command} timed out.`);
      error.stderr = stderr;
      reject(error);
    }, timeoutMs);

    processHandle.stdout.on("data", (chunk) => { stdout += chunk; });
    processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
    processHandle.on("error", (error) => {
      clearTimeout(timeout);
      error.stderr = stderr;
      reject(error);
    });
    processHandle.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(`${command} exited with code ${code}.`);
      error.code = code;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function spawnCli(command, args, options = {}) {
  const executable = resolveCli(command);
  const useShell = isWindowsCommandScript(executable);
  return spawn(
    useShell ? quoteForWindowsShell(executable) : executable,
    useShell ? args.map(quoteForWindowsShell) : args,
    {
      ...options,
      shell: useShell,
      windowsHide: true,
    },
  );
}

// resolveCli returns the bare name only when the executable exists nowhere on
// PATH or in the known install directories.
function cliInstalled(name) {
  return resolveCli(name) !== name;
}

// Providers that are absent from this device entirely are hidden from every
// surface instead of shown as "action needed".
function notDetectedError(message) {
  const error = new Error(message);
  error.notDetected = true;
  return error;
}

function commandError(command, error) {
  if (error.code === "ENOENT") {
    return `${command} CLI was not found. Install it and sign in, then refresh.`;
  }
  return error.stderr?.trim() || error.message || `${command} could not be started.`;
}

async function runJson(command, args) {
  try {
    const { stdout } = await runCli(command, args);
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(commandError(command, error));
  }
}

module.exports = {
  resolveCli,
  runCli,
  spawnCli,
  cliInstalled,
  notDetectedError,
  commandError,
  runJson,
};
