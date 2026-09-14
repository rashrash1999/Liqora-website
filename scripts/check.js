"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const roots = ["js", "api", "server", "scripts", "tests"];
const files = [];

function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))) files.push(fullPath);
    }
}

for (const directory of roots) walk(path.join(root, directory));

for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
