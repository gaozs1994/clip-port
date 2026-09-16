const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const targetDir = path.join(projectRoot, "src", "renderer", "vendor");
const candidates = [
  path.join(projectRoot, "node_modules", "lucide", "dist", "umd", "lucide.min.js"),
  path.join(projectRoot, "node_modules", "lucide", "dist", "umd", "lucide.js"),
];

const source = candidates.find((candidate) => fs.existsSync(candidate));
if (!source) {
  console.error("Unable to locate the Lucide UMD build. Run npm install first.");
  process.exitCode = 1;
} else {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, path.join(targetDir, "lucide.min.js"));
  console.log(`Vendored ${path.relative(projectRoot, source)}`);
}
