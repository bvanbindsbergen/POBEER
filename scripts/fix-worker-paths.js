// Post-build script to fix @/* path aliases in compiled worker files
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist", "worker");

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");
  const relativeToSrc = path.relative(path.dirname(filePath), distDir);

  // Replace @/ with relative path to dist/worker (which maps to src/)
  content = content.replace(
    /require\("@\//g,
    `require("${relativeToSrc.replace(/\\/g, "/")}/`
  );

  fs.writeFileSync(filePath, content);
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith(".js")) {
      fixFile(fullPath);
    }
  }
}

if (fs.existsSync(distDir)) {
  walkDir(distDir);
  console.log("Worker paths fixed successfully");
} else {
  console.log("No dist/worker directory found");
}
