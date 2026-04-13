const fs = require('fs');
const path = require('path');

const root = process.cwd();
const required = [
  'package.json',
  'setup.sh',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
  'README.md',
  'CONTRIBUTING',
  'Examples',
  'failure-catalog.json',
  'failure-catalog.schema.json',
];

const errors = [];

for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    errors.push('Missing required file: ' + file);
  }
}

// setup.sh sanity
if (fs.existsSync('setup.sh')) {
  const setup = fs.readFileSync('setup.sh', 'utf8');
  if (setup.includes('```')) {
    errors.push('setup.sh contains code fences');
  }
}

// skills frontmatter
const skillsDir = path.join(root, 'skills');
if (!fs.existsSync(skillsDir)) {
  errors.push('skills directory missing');
} else {
  const dirs = fs.readdirSync(skillsDir).filter((d) => {
    // Skip _shared (cross-mode reference docs) and hidden dirs
    if (d.startsWith('_') || d.startsWith('.')) return false;
    return fs.statSync(path.join(skillsDir, d)).isDirectory();
  });
  for (const dir of dirs) {
    const skillPath = path.join(skillsDir, dir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      errors.push('Missing SKILL.md: skills/' + dir);
      continue;
    }
    const content = fs.readFileSync(skillPath, 'utf8');
    const lines = content.split('\n');
    if (lines[0].trim() !== '---') {
      errors.push('Frontmatter missing opening ---: skills/' + dir + '/SKILL.md');
      continue;
    }
    const closeIndex = lines.slice(1).findIndex((l) => l.trim() === '---');
    if (closeIndex === -1) {
      errors.push('Frontmatter missing closing ---: skills/' + dir + '/SKILL.md');
      continue;
    }
    const fm = lines.slice(1, closeIndex + 1).join('\n');
    if (!/name:\s*\S+/i.test(fm)) {
      errors.push('Frontmatter missing name: skills/' + dir + '/SKILL.md');
    }
    if (!/description:\s*.+/i.test(fm)) {
      errors.push('Frontmatter missing description: skills/' + dir + '/SKILL.md');
    }
  }
}

if (errors.length) {
  console.error('Validation failed:');
  for (const err of errors) console.error('- ' + err);
  process.exit(1);
}

console.log('Validation passed.');
