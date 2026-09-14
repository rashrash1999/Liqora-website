"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const directories = ["css", "images", "js"];
const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html"));

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const directory of directories) {
    fs.cpSync(path.join(root, directory), path.join(dist, directory), { recursive: true });
}

for (const file of htmlFiles) {
    fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

console.log(`Built ${htmlFiles.length} HTML files into dist/`);
