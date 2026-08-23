#!/usr/bin/env node
/**
 * start-mcp.cjs - Cross-platform launcher for dev-notes-mcp
 *
 * When VS Code installs this plugin from source, it clones the repo
 * but does NOT run npm install. This launcher:
 *   1. Checks if @modelcontextprotocol/sdk is installed
 *   2. If not, runs `npm install --production` automatically
 *   3. Starts the MCP server (dist/index.js)
 *
 * Fallback: if npm install fails, falls back to npx which handles
 * everything (download, install, run) in one step.
 */

const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = __dirname;
const sdkPath = path.join(root, "node_modules", "@modelcontextprotocol", "sdk");

// Step 1: Ensure dependencies are installed
if (!fs.existsSync(sdkPath)) {
  process.stderr.write("[dev-notes-mcp] First run: installing dependencies...\n");
  try {
    execSync("npm install --production", {
      cwd: root,
      stdio: "pipe",
      timeout: 60000,
    });
    process.stderr.write("[dev-notes-mcp] Dependencies installed.\n");
  } catch (e) {
    process.stderr.write(
      "[dev-notes-mcp] npm install failed: " + (e.message || "unknown error") + "\n"
    );
  }
}

// Step 2: Start the MCP server
if (fs.existsSync(sdkPath)) {
  // Direct launch - deps are ready
  const child = spawn(process.execPath, [path.join(root, "dist", "index.js")], {
    stdio: "inherit",
    cwd: root,
  });
  child.on("exit", (code) => process.exit(code || 0));
  child.on("error", (err) => {
    process.stderr.write("[dev-notes-mcp] Failed to start: " + err.message + "\n");
    process.exit(1);
  });
} else {
  // Fallback: use npx (downloads & runs in one step)
  process.stderr.write("[dev-notes-mcp] Using npx fallback...\n");
  const child = spawn(
    "npx",
    ["-y", "github:gaoqixiangdebaba/my_note"],
    {
      stdio: "inherit",
      cwd: root,
      shell: true,
    }
  );
  child.on("exit", (code) => process.exit(code || 0));
  child.on("error", (err) => {
    process.stderr.write("[dev-notes-mcp] npx fallback failed: " + err.message + "\n");
    process.exit(1);
  });
}
