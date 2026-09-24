const major = Number.parseInt(process.versions.node.split('.')[0], 10);

if (major !== 24) {
  console.error(`Node.js 24 is required (detected ${process.version}).`);
  process.exit(1);
}

console.log(`Node.js ${process.version} matches the supported Node 24 runtime baseline.`);
