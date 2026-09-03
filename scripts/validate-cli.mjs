#!/usr/bin/env node

import { execSync } from 'node:child_process';

console.log('🔍 Running Native Agent CLI Validations (Offline)...\n');

let checked = 0;
let errors = 0;

function runCmd(name, cmd) {
  try {
    const output = execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
    console.log(`✅ [${name}] Validation passed`);
    if (output.trim()) {
      console.log(output.trim().split('\n').map(line => `   ${line}`).join('\n'));
    }
  } catch (err) {
    errors++;
    console.error(`❌ [${name}] Validation failed`);
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
  }
}

function hasBin(bin) {
  try {
    execSync(`which ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 1. Claude Code CLI Validation
if (hasBin('claude')) {
  checked++;
  console.log('--- Testing with Claude Code CLI ---');
  runCmd('Claude Plugin', 'claude plugin validate .claude-plugin/plugin.json');
  runCmd('Claude Marketplace', 'claude plugin validate .');
  console.log();
} else {
  console.log('ℹ Claude Code CLI not found in PATH (skipped)\n');
}

// 2. Google Antigravity CLI Validation
if (hasBin('agy')) {
  checked++;
  console.log('--- Testing with Antigravity (agy) CLI ---');
  runCmd('Antigravity Plugin', 'agy plugin validate .');
  console.log();
} else {
  console.log('ℹ Antigravity (agy) CLI not found in PATH (skipped)\n');
}

// 3. OpenAI Codex CLI Validation
if (hasBin('codex')) {
  checked++;
  console.log('--- Testing with OpenAI Codex CLI ---');
  runCmd('Codex Marketplace & Plugin', 'codex plugin marketplace add . && codex plugin list | grep masthead-agent-tools');
  console.log();
} else {
  console.log('ℹ OpenAI Codex CLI not found in PATH (skipped)\n');
}

// Summary
console.log('================================');
if (errors > 0) {
  console.error(`❌ Native CLI validation failed with ${errors} error(s).`);
  process.exit(1);
} else if (checked === 0) {
  console.warn('⚠️ No AI agent CLIs (claude, agy, codex) found in PATH.');
  process.exit(0);
} else {
  console.log(`🎉 All ${checked} detected agent CLI validator(s) passed successfully!`);
  process.exit(0);
}
