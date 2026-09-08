---
description: Triage, trace lineage, and investigate active Masthead data incidents
---

# Masthead Incident Triaging

Launch the incident triaging workflow using `masthead-incident-triaging`. Focus from the user, if any: `$ARGUMENTS` — an incident id, a table (`project.dataset.table`), or a project; when empty, start from the open incidents list.

1. Connect to the Masthead MCP server to scan active incidents across monitored GCP projects.
2. Analyze upstream pipelines and downstream consumer impact.
3. Formulate root cause hypotheses and draft incident notes or owner assignments.
