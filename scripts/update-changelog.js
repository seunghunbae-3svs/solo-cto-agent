const fs = require('fs');
const { execSync } = require('child_process');

const path = 'CHANGELOG';
let content = fs.readFileSync(path, 'utf8');
const header = '# Changelog';
if (!content.startsWith(header)) {
  console.error('CHANGELOG missing header');
  process.exit(1);
}

if (!content.includes('## Unreleased')) {
  content = content.replace(header, header + '\n\n## Unreleased\n');
}

const latest = execSync('git log -1 --pretty=%s').toString().trim();
if (!latest || latest.startsWith('chore: update changelog')) {
  console.log('No changelog update needed.');
  fs.writeFileSync(path, content);
  process.exit(0);
}

const sections = content.split('\n## ');
const unreleasedIndex = sections.findIndex((s) => s.startsWith('Unreleased'));
if (unreleasedIndex === -1) {
  console.error('Unreleased section missing');
  process.exit(1);
}

let unreleased = sections[unreleasedIndex];
if (unreleased.includes(latest)) {
  console.log('Changelog already includes latest commit');
  process.exit(0);
}

unreleased = unreleased.replace('Unreleased', 'Unreleased\n\n* ' + latest);
sections[unreleasedIndex] = unreleased;
content = sections.join('\n## ');
fs.writeFileSync(path, content);
console.log('Changelog updated.');
