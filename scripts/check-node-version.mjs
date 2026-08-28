const major = Number.parseInt(process.versions.node.split('.')[0], 10);

if (major !== 20) {
  console.error(`Node.js 20 is required (detected ${process.version}).`);
  process.exit(1);
}

console.log(`Node.js ${process.version} matches the supported runtime baseline.`);
