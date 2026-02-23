import sharp from "sharp";
import { resolve, dirname } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconDir = resolve(__dirname, "..", "src", "assets", "icons");

for (const size of [16, 48, 128]) {
  const svgPath = resolve(iconDir, `icon${size}.svg`);
  const pngPath = resolve(iconDir, `icon${size}.png`);
  const svgBuffer = readFileSync(svgPath);
  await sharp(svgBuffer).resize(size, size).png().toFile(pngPath);
  console.log(`Created icon${size}.png`);
}

console.log("Done — PNG icons created.");
