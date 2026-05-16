#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const templatePath = path.join(root, "docs/download-page/index.html.template");
const siteDir = path.join(root, "_site");
const siteIndex = path.join(siteDir, "index.html");
const assetsSrc = path.join(root, "docs/download-page/assets");
const assetsDest = path.join(siteDir, "download-page/assets");

const repo = process.env.GITHUB_REPO || process.env.npm_package_repository?.url || "__REPO__";

function buildDownloadPage() {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Missing template: ${templatePath}`);
  }

  let html = fs.readFileSync(templatePath, "utf8");
  if (repo !== "__REPO__") {
    html = html.replaceAll("__REPO__", repo);
  }

  fs.mkdirSync(siteDir, { recursive: true });
  fs.mkdirSync(path.join(siteDir, "download-page"), { recursive: true });
  fs.writeFileSync(siteIndex, html, "utf8");

  if (fs.existsSync(assetsSrc)) {
    fs.cpSync(assetsSrc, assetsDest, { recursive: true });
  }

  if (!fs.existsSync(path.join(siteDir, ".nojekyll"))) {
    fs.writeFileSync(path.join(siteDir, ".nojekyll"), "", "utf8");
  }

  console.log(`[download-page:build] → ${siteIndex}`);
}

buildDownloadPage();
