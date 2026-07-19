import fs from "fs";

try {
  fs.copyFileSync("manifest.json", "dist/manifest.json");
  console.log("SUCCESS: manifest.json copied to dist/manifest.json");
} catch (err) {
  console.error("FAILED to copy manifest.json:", err);
  process.exit(1);
}
