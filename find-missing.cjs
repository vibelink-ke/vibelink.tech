const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, 'src');
const pagesDir = path.join(srcDir, 'pages');
const componentsDir = path.join(srcDir, 'components');

const missingFiles = new Set();

function checkFile(importPath, fromFile) {
  let absolutePath = '';
  if (importPath.startsWith('@/')) {
    absolutePath = path.join(srcDir, importPath.slice(2));
  } else if (importPath.startsWith('../')) {
    absolutePath = path.resolve(path.dirname(fromFile), importPath);
  } else if (importPath.startsWith('./')) {
    absolutePath = path.resolve(path.dirname(fromFile), importPath);
  } else {
    return; // Ignore other imports
  }

  // Extensions to check
  const extensions = ['', '.jsx', '.jsx', '.js', '/index.jsx', '/index.js'];
  let exists = false;
  for (const ext of extensions) {
    if (fs.existsSync(absolutePath + ext)) {
      exists = true;
      break;
    }
  }

  if (!exists) {
    missingFiles.add(`${importPath} (imported by ${path.relative(srcDir, fromFile)})`);
  }
}

const pageFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.jsx') || f.endsWith('.js'));

pageFiles.forEach(file => {
  const filePath = path.join(pagesDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const importRegex = /import\s+(?:[^{}\s,]+|{[^{}]+})\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    checkFile(match[1], filePath);
  }
});

console.log('--- MISSING COMPONENTS ---');
Array.from(missingFiles).sort().forEach(f => console.log(f));
