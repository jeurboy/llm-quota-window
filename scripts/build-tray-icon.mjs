import sharp from "sharp";
import { join } from "node:path";

const root = process.cwd();
const source = join(root, "assets", "tray-icon.svg");

await Promise.all([
  sharp(source).resize(18, 18).png().toFile(join(root, "assets", "trayTemplate.png")),
  sharp(source).resize(36, 36).png().toFile(join(root, "assets", "trayTemplate@2x.png")),
]);

console.log("Generated macOS tray template icons (18px and 36px).");
