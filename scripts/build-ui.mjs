#!/usr/bin/env node
/**
 * 把 ui/vendor.ts（Material Web 组件 + MD3 配色工具）打成 public/vendor/material.js。
 * 本地自托管，不依赖 CDN —— Telegram 内置浏览器在部分网络下取不到外部 CDN。
 */
import { build } from "esbuild";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outfile = resolve(root, "public/vendor/material.js");

const result = await build({
  entryPoints: [resolve(root, "ui/vendor.ts")],
  bundle: true,
  format: "esm",
  target: ["es2020"],
  minify: true,
  legalComments: "none",
  outfile,
  metafile: true,
  logLevel: "warning",
});

const size = statSync(outfile).size;
const inputs = Object.keys(result.metafile.inputs).length;
console.log(`material.js: ${(size / 1024).toFixed(1)} KiB（${inputs} 个模块）`);
