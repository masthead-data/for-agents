#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function error(msg) {
  errors.push(msg);
  console.error(`❌ ${msg}`);
}

function success(msg) {
  console.log(`✅ ${msg}`);
}

function loadJson(relPath) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    error(`Missing file: ${relPath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (err) {
    error(`Invalid JSON in ${relPath}: ${err.message}`);
    return null;
  }
}

console.log('🔍 Validating Multiplatform Plugin Repository...\n');

// 1. Root plugin.json is the Single Source of Truth
const rootPlugin = loadJson('plugin.json');
if (!rootPlugin) process.exit(1);

const { name: pluginName, version: pluginVersion } = rootPlugin;
console.log(`📦 Target Plugin: "${pluginName}" (v${pluginVersion || 'unspecified'})\n`);

// 2. Declarative Manifest Schema Checks
const MANIFESTS = [
  {
    path: 'package.json',
    required: ['name', 'version', 'scripts'],
    matchName: true
  },
  {
    path: 'plugin.json',
    required: ['$schema', 'name', 'version', 'description']
  },
  {
    path: '.claude-plugin/plugin.json',
    required: ['name', 'skills', 'mcpServers'],
    matchName: true
  },
  {
    path: '.claude-plugin/marketplace.json',
    required: ['name', 'owner', 'plugins'],
    validate: (data) => {
      const match = data.plugins?.some((p) => p.name === pluginName);
      return match ? null : `Marketplace plugins do not contain "${pluginName}"`;
    }
  },
  {
    path: '.codex-plugin/plugin.json',
    required: ['name', 'skills', 'mcpServers'],
    matchName: true
  }
];

console.log('--- Checking Platform Manifests ---');
for (const spec of MANIFESTS) {
  const data = loadJson(spec.path);
  if (!data) continue;

  const missing = spec.required.filter((k) => data[k] === undefined);
  if (missing.length > 0) {
    error(`${spec.path}: Missing required fields: ${missing.join(', ')}`);
    continue;
  }

  if (spec.matchName && data.name !== pluginName) {
    error(`${spec.path}: Name mismatch (expected "${pluginName}", got "${data.name}")`);
    continue;
  }

  if (spec.validate) {
    const customErr = spec.validate(data);
    if (customErr) {
      error(`${spec.path}: ${customErr}`);
      continue;
    }
  }

  success(`${spec.path} is valid`);
}

// 3. Declarative MCP Configurations Validation
console.log('\n--- Checking MCP Configurations ---');
const MCP_CONFIGS = [
  {
    path: 'mcp.json',
    standard: 'Agent Plugins 1.0.0',
    validateServer: (srv) => srv && (srv.url || srv.command)
  },
  {
    path: 'mcp_config.json',
    standard: 'Antigravity engine',
    validateServer: (srv) => srv && (srv.serverUrl || srv.command)
  }
];

for (const mcp of MCP_CONFIGS) {
  const data = loadJson(mcp.path);
  if (!data) continue;

  const servers = data.mcpServers ? Object.entries(data.mcpServers) : [];
  if (servers.length === 0) {
    error(`${mcp.path}: "mcpServers" is empty or missing`);
    continue;
  }

  const invalid = servers.find(([, srv]) => !mcp.validateServer(srv));
  if (invalid) {
    error(`${mcp.path}: Server "${invalid[0]}" missing endpoint or command`);
    continue;
  }

  success(`${mcp.path} is valid (${mcp.standard})`);
}

// 4. Dynamic Skills & Frontmatter Integrity
console.log('\n--- Checking Skills & Frontmatter Integrity ---');
const skillsDir = path.join(rootDir, 'skills');

if (!fs.existsSync(skillsDir)) {
  error('Missing skills/ directory');
} else {
  const skillFolders = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  if (skillFolders.length === 0) {
    error('skills/ directory contains no subdirectories');
  }

  for (const folder of skillFolders) {
    const skillFile = path.join(skillsDir, folder, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      error(`skills/${folder}: Missing SKILL.md`);
      continue;
    }

    const content = fs.readFileSync(skillFile, 'utf8');
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
      error(`skills/${folder}/SKILL.md: Missing YAML frontmatter`);
      continue;
    }

    const fm = fmMatch[1];
    const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const desc = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();

    if (!name) {
      error(`skills/${folder}/SKILL.md: Frontmatter missing "name"`);
    } else if (name !== folder) {
      error(`skills/${folder}/SKILL.md: Frontmatter name "${name}" does not match folder "${folder}"`);
    }

    if (!desc) {
      error(`skills/${folder}/SKILL.md: Frontmatter missing or empty "description"`);
    }

    const body = content.slice(fmMatch[0].length).trim();
    if (body.length < 50) {
      error(`skills/${folder}/SKILL.md: Body content is empty or incomplete`);
      continue;
    }

    success(`skills/${folder}/SKILL.md is valid`);
  }
}

// 5. Summary
console.log('\n================================');
if (errors.length > 0) {
  console.error(`❌ Validation failed with ${errors.length} error(s).`);
  process.exit(1);
} else {
  console.log('🎉 All manifests, MCP configs, and skills passed validation successfully!');
  process.exit(0);
}
