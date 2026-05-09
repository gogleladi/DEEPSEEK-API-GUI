/**
 * Rasterize public/favicon.svg → build/icon.png for Electron / electron-builder (Windows .exe / installer icons need PNG/ICO).
 */
const path = require("path");
const fs = require("fs/promises");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const svgPath = path.join(root, "public", "favicon.svg");
const outDir = path.join(root, "build");
const outPath = path.join(outDir, "icon.png");

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await sharp(svgPath, { density: 300 })
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  console.log("Wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
