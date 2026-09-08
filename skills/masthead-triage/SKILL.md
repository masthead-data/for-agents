---
name: masthead-triage
description: Triage active Masthead incidents with lineage and blast-radius analysis. Same workflow as the Claude Code `/triage` command, invocable as `$masthead-triage` in Codex.
compatibility: Requires the Masthead MCP server and the masthead-incident-triaging skill from this plugin.
---

# Masthead Incident Triaging

Launch the incident triaging workflow using `masthead-incident-triaging`:

1. Connect to the Masthead MCP server to scan active incidents across monitored GCP projects.
2. Analyze upstream pipelines and downstream consumer impact.
3. Formulate root cause hypotheses and draft incident notes or owner assignments.
