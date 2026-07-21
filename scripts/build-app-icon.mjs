// Builds the WatchTime app-icon + splash source assets from the chosen
// "TV + W monogram" mark, then they're fed to @capacitor/assets. The mark
// (a minimal TV outline with antenna + legs and a coral "W" on the screen)
// is composed here into the layers Android needs: full legacy icon,
// adaptive foreground/background, and splash. All coordinates live in a
// 0..1024 space; per-layer scaling keeps the mark inside the adaptive
// safe zone (foreground a touch larger, splash smaller with more padding).
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const BG = "#0A0A0B";
const LINE = "#F2F1EF"; // near-white TV
const ACCENT = "#FF4433"; // coral W

// The mark, centered in the 1024 canvas (background drawn separately).
const MARK =
  `<g fill="none" stroke-linecap="round">` +
  // antenna (V) + legs
  `<path d="M 452 340 L 382 250 M 572 340 L 642 250" stroke="${LINE}" stroke-width="22"/>` +
  `<path d="M 362 680 L 322 748 M 662 680 L 702 748" stroke="${LINE}" stroke-width="22"/>` +
  // TV body
  `<rect x="262" y="340" width="500" height="340" rx="52" stroke="${LINE}" stroke-width="28"/>` +
  // coral W on the screen
  `<path d="M 402 430 L 457 580 L 512 490 L 567 580 L 622 430" stroke="${ACCENT}" stroke-width="36" stroke-linejoin="round"/>` +
  `</g>`;

// scale about the canvas centre (512,512)
const scaled = (s) => `<g transform="translate(512 512) scale(${s}) translate(-512 -512)">${MARK}</g>`;

function svg({ size = 1024, bg = null, scale = 1 }) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">` +
      (bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : "") +
      (scale > 0 ? scaled(scale) : "") +
      `</svg>`
  );
}

async function png(out, opts, raster) {
  await sharp(svg(opts)).resize(raster, raster).png().toFile(out);
  console.log("wrote", out);
}

mkdirSync("assets", { recursive: true });
// Legacy square icon: dark bg + mark at natural size.
await png("assets/icon.png", { bg: BG, scale: 1.0 }, 1024);
// Adaptive layers: mark alone (slightly larger, still inside the safe zone) + solid bg.
await png("assets/icon-foreground.png", { bg: null, scale: 1.1 }, 1024);
await png("assets/icon-background.png", { bg: BG, scale: 0 }, 1024);
// Splash: smaller centred mark with generous padding (light+dark both dark-themed).
await png("assets/splash.png", { bg: BG, scale: 0.62 }, 2732);
await png("assets/splash-dark.png", { bg: BG, scale: 0.62 }, 2732);
console.log("done");
