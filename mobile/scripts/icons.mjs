// Generates the Android launcher icons and splash screens from the TripDeck logo (public/icon.svg).
// Run with `bun run icons:mobile` after changing the logo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const res = at("../android/app/src/main/res/");
const svg = readFileSync(at("../../public/icon.svg"), "utf8");

/** The logo's tile colour; also the adaptive icon background and the splash screen. */
const TILE = "#0e7490";
const tile = /<rect width="512" height="512"[^>]*\/>/;
if (!tile.test(svg) || !svg.includes(`fill="${TILE}"`)) throw new Error("public/icon.svg no longer starts with its tile");
/** The logo without its rounded tile, in the 512 × 512 viewBox. */
const artwork = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(tile, "");

/** `artwork` scaled to `scale` of a square canvas and centred, on an optional background shape. */
const compose = (scale, background = "") => {
  const offset = (512 * (1 - scale)) / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${background}` +
      `<g transform="translate(${offset} ${offset}) scale(${scale})">${artwork}</g></svg>`,
  );
};

const png = (input, size, file) => sharp(input, { density: 600 }).resize(size, size).png().toFile(res + file);

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [name, k] of Object.entries(densities)) {
  // Adaptive icon (Android 8+): launchers mask the middle ~66 dp of the 108 dp layer to their own
  // shape. At 58 dp the logo's columns take about 60% of that circle, like other launcher icons.
  await png(compose(58 / 108), 108 * k, `mipmap-${name}/ic_launcher_foreground.png`);
  // Older launchers: the logo as it is, and a round version.
  await png(Buffer.from(svg), 48 * k, `mipmap-${name}/ic_launcher.png`);
  await png(compose(0.8, `<circle cx="256" cy="256" r="256" fill="${TILE}"/>`), 48 * k, `mipmap-${name}/ic_launcher_round.png`);
}

// Splash before Android 12 (later versions show the launcher icon on the theme's splash colour).
const splashes = {
  drawable: [480, 320],
  "drawable-land-mdpi": [480, 320],
  "drawable-land-hdpi": [800, 480],
  "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960],
  "drawable-land-xxxhdpi": [1920, 1280],
  "drawable-port-mdpi": [320, 480],
  "drawable-port-hdpi": [480, 800],
  "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600],
  "drawable-port-xxxhdpi": [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(splashes)) {
  const logo = Math.round(Math.min(w, h) * 0.4);
  await sharp({ create: { width: w, height: h, channels: 4, background: TILE } })
    .composite([{ input: await sharp(compose(1), { density: 600 }).resize(logo, logo).png().toBuffer() }])
    .png()
    .toFile(`${res}${dir}/splash.png`);
}

console.log("Android icons and splash screens updated.");
