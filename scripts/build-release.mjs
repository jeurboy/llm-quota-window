import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const projectRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const outputDirectory = join("releases", `v${version}`);
const requestedTarget = process.argv.slice(2).find((argument) => ["--mac", "--win", "--all"].includes(argument));

function platformTarget() {
  if (requestedTarget) return requestedTarget;
  if (process.platform === "darwin") return "--mac";
  if (process.platform === "win32") return "--win";
  throw new Error("Choose a target explicitly: --mac, --win, or --all.");
}

const target = platformTarget();
const trayIconBuild = spawnSync(process.execPath, [join(projectRoot, "scripts", "build-tray-icon.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});
if (trayIconBuild.error) throw trayIconBuild.error;
if (trayIconBuild.status !== 0) process.exit(trayIconBuild.status ?? 1);

const executable = join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);

if (!existsSync(executable)) {
  throw new Error("electron-builder is missing. Run `npm install` first.");
}

for (const icon of ["assets/app-icon.icns", "assets/app-icon.ico", "assets/trayTemplate.png", "assets/trayTemplate@2x.png"]) {
  if (!existsSync(join(projectRoot, icon))) {
    throw new Error(`Missing build icon: ${icon}`);
  }
}

mkdirSync(join(projectRoot, outputDirectory), { recursive: true });
mkdirSync(join(projectRoot, "releases"), { recursive: true });
const releaseReadme = readFileSync(join(projectRoot, "RELEASE_README.md"), "utf8");
writeFileSync(join(projectRoot, "releases", "README.md"), releaseReadme);

const jobs = target === "--all"
  ? [
      ["--mac", "dmg", "zip"],
      ["--win", "nsis", "portable", "--x64"],
    ]
  : target === "--mac"
    ? [["--mac", "dmg", "zip"]]
    : [["--win", "nsis", "portable", "--x64"]];

console.log(`Building Quota Window v${version} into ${outputDirectory}/`);

for (const jobArgs of jobs) {
  const result = spawnSync(executable, [
    ...jobArgs,
    `--config.directories.output=${outputDirectory}`,
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(process.platform === "darwin" && !process.env.CSC_IDENTITY_AUTO_DISCOVERY
        ? { CSC_IDENTITY_AUTO_DISCOVERY: "false" }
        : {}),
    },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Release complete: ${outputDirectory}/ (shared downloader guide: releases/README.md)`);
