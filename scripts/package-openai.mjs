#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestPath = path.join(rootDir, "plugin.json");
const distDir = path.join(rootDir, "dist");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    fail(`${command} failed: ${detail}`);
  }
}

if (!fs.existsSync(manifestPath)) {
  fail("Missing plugin.json.");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!manifest.name || !manifest.version) {
  fail("plugin.json must declare both name and version.");
}

const archiveName = `${manifest.name}-${manifest.version}.zip`;
const archivePath = path.join(distDir, archiveName);

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(archivePath, { force: true });

const trackedFiles = run("git", ["ls-files", "-co", "--exclude-standard", "-z"])
  .split("\0")
  .filter(Boolean)
  .filter((file) => !file.startsWith("dist/") && !file.startsWith(".git/"));

if (!trackedFiles.includes("plugin.json")) {
  fail("The submission package must include plugin.json.");
}

const zip = spawnSync("zip", ["-q", archivePath, "-@"], {
  cwd: rootDir,
  encoding: "utf8",
  input: `${trackedFiles.join("\n")}\n`,
});

if (zip.error || zip.status !== 0) {
  fail(
    `zip failed: ${zip.stderr?.trim() || zip.error?.message || "unknown error"}`,
  );
}

run("unzip", ["-t", archivePath]);

console.log(`✅ Created and verified ${path.relative(rootDir, archivePath)}`);
