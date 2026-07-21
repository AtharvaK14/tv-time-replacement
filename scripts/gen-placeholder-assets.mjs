// Generates PLACEHOLDER icon/splash source images for @capacitor/assets.
// The mark is a simple geometric "W" (WatchTime) in the app's accent on its
// dark background — deliberately plain, meant to be replaced with real
// artwork before store submission. Drawn as vector paths (not SVG <text>,
// which sharp can't reliably rasterize). Run: node scripts/gen-placeholder-assets.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const BG = "#0A0A0B";
const ACCENT = "#FF4433";

// A "W" polyline centered in a `size` box, scaled by `frac` of the box.
function wPath(size, frac, color, stroke) {
  const span = size * frac;
  const x0 = (size - span) / 2;
  const y0 = (size - span * 0.62) / 2;
  const p = (fx, fy) => `${(x0 + fx * span).toFixed(1)},${(y0 + fy * span * 0.62).toFixed(1)}`;
  const pts = [p(0, 0), p(0.21, 1), p(0.5, 0.3), p(0.79, 1), p(1, 0)].join(" ");
  return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function svg(size, { bg, mark, frac }) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      (bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : "") +
      (mark ? wPath(size, frac, ACCENT, size * 0.05) : "") +
      `</svg>`
  );
}

async function png(out, size, opts) {
  await sharp(svg(size, opts)).png().toFile(out);
  console.log("wrote", out);
}

mkdirSync("assets", { recursive: true });
// Legacy square icon + adaptive foreground/background.
await png("assets/icon.png", 1024, { bg: BG, mark: true, frac: 0.42 });
await png("assets/icon-foreground.png", 1024, { bg: null, mark: true, frac: 0.36 }); // transparent, mark in adaptive safe zone
await png("assets/icon-background.png", 1024, { bg: BG, mark: false, frac: 0 });
// Splash (light+dark both dark, since the app is dark-themed).
await png("assets/splash.png", 2732, { bg: BG, mark: true, frac: 0.22 });
await png("assets/splash-dark.png", 2732, { bg: BG, mark: true, frac: 0.22 });
console.log("done");
