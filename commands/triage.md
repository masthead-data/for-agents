---
description: Triage, trace lineage, and investigate active Masthead data incidents
---

# Masthead Incident Triaging

Launch the incident triaging workflow using `masthead-incident-triaging`. Focus from the user, if any: `$ARGUMENTS` — an incident id, a table (`project.dataset.table`), or a project; when empty, start from the open incidents list.

1. Connect to the Masthead MCP server and size the open incident queue by monitoring tier and type.
2. Group incidents that share a cause, and separate new ones from recurring and stale ones.
3. Analyze upstream pipelines and downstream consumer impact, one investigation per group.
4. State the root cause as confirmed, likely or unknown, with the evidence, and propose a severity.
5. Relate incidents: link causes and impacts from the evidence in this environment.
6. Draft incident notes, owner assignments, mutes and status changes for sign-off.
