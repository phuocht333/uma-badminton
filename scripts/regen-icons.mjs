import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ICONS = resolve(HERE, "..", "public", "icons");
const svg = readFileSync(resolve(ICONS, "icon.svg"), "utf-8");

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];
for (const t of targets) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: t.size } })
    .render()
    .asPng();
  writeFileSync(resolve(ICONS, t.file), png);
  console.log(`wrote ${t.file} (${t.size}x${t.size})`);
}
