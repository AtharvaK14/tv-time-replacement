// Builds the WatchTime app-icon + splash source assets from the chosen
// play-triangle mark, then they're fed to @capacitor/assets. The triangle
// path came from the design pass; here it's composed into the layers Android
// needs (full legacy icon, adaptive foreground/background, splash), with a
// small left nudge so the play button sits at optical centre.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const BG = "#0A0A0B";
const SURFACE_STOP1 = "#FF4433";
const SURFACE_STOP2 = "#FF7A2F";

// Rounded play triangle in a 0..1024 space (right-pointing).
const TRI = "M 360 360 L 360 664 Q 360 704 395 685 L 675 533 Q 715 512 675 491 L 395 339 Q 360 320 360 360 Z";
const GRAD =
  `<linearGradient id="g" x1="360" y1="330" x2="700" y2="694" gradientUnits="userSpaceOnUse">` +
  `<stop offset="0" stop-color="${SURFACE_STOP1}"/><stop offset="1" stop-color="${SURFACE_STOP2}"/></linearGradient>`;

// scale about centre (512,512), then a -14px x nudge to trim the play
// button's natural right-heaviness to optical centre.
function mark(scale) {
  return (
    `<g transform="translate(512 512) scale(${scale}) translate(-512 -512) translate(-14 0)">` +
    `<path fill="url(#g)" d="${TRI}"/></g>`
  );
}

function svg({ size = 1024, bg = null, scale = 1 }) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">` +
      `<defs>${GRAD}</defs>` +
      (bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : "") +
      (scale > 0 ? mark(scale) : "") +
      `</svg>`
  );
}

async function png(out, opts, raster) {
  await sharp(svg(opts)).resize(raster, raster).png().toFile(out);
  console.log("wrote", out);
}

mkdirSync("assets", { recursive: true });
// Legacy square icon: dark bg + mark.
await png("assets/icon.png", { bg: BG, scale: 1.0 }, 1024);
// Adaptive layers: mark alone (bigger, for the safe zone) + solid bg.
await png("assets/icon-foreground.png", { bg: null, scale: 1.3 }, 1024);
await png("assets/icon-background.png", { bg: BG, scale: 0 }, 1024);
// Splash: small centred mark on the dark bg (both light+dark are dark themed).
await png("assets/splash.png", { bg: BG, scale: 0.55 }, 2732);
await png("assets/splash-dark.png", { bg: BG, scale: 0.55 }, 2732);
console.log("done");
