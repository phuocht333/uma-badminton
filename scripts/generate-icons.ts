/**
 * One-shot: render `public/icons/icon.svg` to PNG variants needed for PWA install.
 * Commit the resulting PNGs to the repo so they ship as static assets.
 *
 * Usage: pnpm tsx scripts/generate-icons.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const svg = readFileSync("public/icons/icon.svg");

const variants: Array<{ size: number; name: string }> = [
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
  { size: 180, name: "apple-touch-icon.png" },
];

for (const v of variants) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: v.size } });
  const png = r.render().asPng();
  writeFileSync(`public/icons/${v.name}`, png);
  console.log(`✓ public/icons/${v.name} (${v.size}×${v.size})`);
}
console.log("Done.");
