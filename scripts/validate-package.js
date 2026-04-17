const fs = require('fs');
const path = require('path');

const root = process.cwd();
const required = [
  'package.json',
  'setup.sh',
  'README.md',
  'CONTRIBUTING.md',
  'examples/README.md',
  'docs/claude.md',
  'docs/cursor.md',
  'docs/windsurf.md',
  'benchmarks/dashboard.html',
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

// Feature 3: Validate cursor.md has required sections
if (fs.existsSync('docs/cursor.md')) {
  const cursorContent = fs.readFileSync('docs/cursor.md', 'utf8');
  if (!/^#\s+.*cursor/im.test(cursorContent)) {
    errors.push('docs/cursor.md missing main title');
  }
  if (!/^##\s+.*(Quick Start|Setup)/im.test(cursorContent)) {
    errors.push('docs/cursor.md missing Quick Start or Setup section');
  }
  if (!/\.cursorrules/i.test(cursorContent)) {
    errors.push('docs/cursor.md missing .cursorrules section');
  }
}

// Feature 3: Validate windsurf.md has required sections
if (fs.existsSync('docs/windsurf.md')) {
  const windsurfContent = fs.readFileSync('docs/windsurf.md', 'utf8');
  if (!/^#\s+.*windsurf/im.test(windsurfContent)) {
    errors.push('docs/windsurf.md missing main title');
  }
  if (!/^##\s+.*(Quick Start|Setup)/im.test(windsurfContent)) {
    errors.push('docs/windsurf.md missing Quick Start or Setup section');
  }
  if (!/\.windsurfrules/i.test(windsurfContent)) {
    errors.push('docs/windsurf.md missing .windsurfrules section');
  }
}

// Feature 3: Validate failure-catalog.json has >= 20 entries and proper fields
if (fs.existsSync('failure-catalog.json')) {
  try {
    const catalog = JSON.parse(fs.readFileSync('failure-catalog.json', 'utf8'));
    if (!Array.isArray(catalog.items)) {
      errors.push('failure-catalog.json.items is not an array');
    } else if (catalog.items.length < 20) {
      errors.push(`failure-catalog.json has only ${catalog.items.length} entries (minimum 20 required)`);
    } else {
      for (let i = 0; i < catalog.items.length; i++) {
        const item = catalog.items[i];
        if (!item.id) {
          errors.push(`failure-catalog.json entry ${i} missing id field`);
        }
        if (!item.category) {
          errors.push(`failure-catalog.json entry ${i} missing category field`);
        }
        if (!item.pattern) {
          errors.push(`failure-catalog.json entry ${i} missing pattern field`);
        }
        if (!item.recovery && !item.fix && !item.description) {
          errors.push(`failure-catalog.json entry ${i} missing recovery/fix/description field`);
        }
      }
    }
  } catch (err) {
    errors.push(`failure-catalog.json parse error: ${err.message}`);
  }
}

if (errors.length) {
  console.error('Validation failed:');
  for (const err of errors) console.error('- ' + err);
  process.exit(1);
}

console.log('Validation passed.');
