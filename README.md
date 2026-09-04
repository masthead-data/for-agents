# Masthead Agent Plugins & Skills

A unified, multiplatform agent toolkit for [Masthead Data](https://mastheadata.com) — BigQuery data observability and FinOps cost optimization for Google Cloud.

This repository provides single-source-of-truth plugins and skills for:

- **Claude Code**
- **OpenAI Codex**
- **Antigravity / Gemini CLI**
- **Universal Skills CLI**

---

## Core Capabilities

1. **FinOps (Cost Savings)**: Optimize BigQuery compute, storage, data models, and pipelines based on historical dataset insights.
2. **Real-Time Observability**: Connect via Model Context Protocol (MCP) to investigate, trace lineage, and resolve live pipeline failures and data anomalies.

### Safety Framework: Cautious Advisory (Non-Action)

All FinOps skills adhere to strict non-action principles:

- **Zero Automated Mutations**: The agent **never** executes destructive commands (`bq rm`), alters billing configurations (`bq update`), or disables running pipelines directly.
- **Decision Support & Artifacts**: The agent investigates recency, analyzes lineage and downstream impact, provides clear cost/risk trade-offs, and generates whatever review artifacts the human operator requests (Markdown review tables, CSV candidate exports, or standalone shell scripts with dry-run commands for the user to inspect and run).

---

## Slash Commands

When installed in Claude Code or Antigravity, quick slash commands are available:

- `/triage` — Launch real-time incident triaging, upstream lineage inspection, and blast-radius analysis across monitored GCP projects.
- `/savings` — Audit BigQuery storage and compute waste across tables, datasets, data models, and pipelines.

---

## Installation

### 1. Claude Code

Add the Masthead marketplace and install the plugin:

```text
/plugin marketplace add masthead-data/for-agents
/plugin install masthead-agent-tools@masthead-data
/reload-plugins
```

For local development from a cloned repository:

```bash
claude plugin marketplace add ./
claude plugin install masthead-agent-tools@masthead-data
```

### 2. OpenAI Codex CLI

Add the marketplace and install via Codex CLI:

```bash
codex plugin marketplace add masthead-data/for-agents
codex plugin add masthead-agent-tools@masthead-data
```

Or interactively inside Codex via `/plugins`.

### 3. Google Antigravity & Agent Plugins (1.0.0)

This repository adheres to the vendor-neutral [Agent Plugins 1.0.0](https://agent-plugins.org) specification.

To add this plugin to Antigravity:

- **Workspace Level**: Clone into your project's `.agents/plugins/`:

  ```bash
  git clone https://github.com/masthead-data/for-agents.git .agents/plugins/masthead-agent-tools
  ```

- **Global Level**: Make it available across all workspaces by placing it in `~/.gemini/config/plugins/`:

  ```bash
  git clone https://github.com/masthead-data/for-agents.git ~/.gemini/config/plugins/masthead-agent-tools
  ```

### 4. Universal Skills CLI

Install individual skills or the full suite directly into any project:

```bash
# Install all skills
npx skills add masthead-data/for-agents

# Or install a specific skill
npx skills add masthead-data/for-agents --skill masthead-storage-savings-with-tables
```

---

## Prerequisites & Authentication

- **Masthead Account & Dataset**: A provisioned Masthead insights dataset in BigQuery. [Request access →](https://docs.mastheadata.com/api#get-access-to-bigquery-resources)
- **Google Cloud CLI**: Authenticated via `gcloud auth login` with BigQuery read permissions.
- **MCP Server Authentication**: The Masthead MCP server at `https://mcp.mastheadata.com/mcp` authenticates via native Google OAuth 2.0 popup in your agent client (service account support coming soon).

When a FinOps skill runs for the first time, it prompts for your insights dataset ID (e.g. `masthead-prod.client_xyz_insights`) and caches it into your global (`~/.masthead/config.json`) or project config (`.masthead/config.json`).

---

## Available Skills

| Skill | Category | Mode | Description |
| --- | --- | --- | --- |
| [`masthead-incident-triaging`](skills/masthead-incident-triaging/) | Observability | MCP | Triage, trace upstream/downstream lineage, assign ownership, and manage live incidents. |
| [`masthead-storage-savings-with-tables`](skills/masthead-storage-savings-with-tables/) | FinOps | Local SQL | Identify and clean up dead-end and unused BigQuery tables. |
| [`masthead-storage-savings-with-datasets`](skills/masthead-storage-savings-with-datasets/) | FinOps | Local SQL | Optimize dataset-level billing models (logical vs. physical) and partition expiration. |
| [`masthead-compute-savings-with-data-models`](skills/masthead-compute-savings-with-data-models/) | FinOps | Local SQL | Rebalance Dataform, dbt, and Airflow model compute between reservations and on-demand. |
| [`masthead-compute-savings-with-pipelines`](skills/masthead-compute-savings-with-pipelines/) | FinOps | Local SQL | Detect and pause legacy, orphaned, or inefficient data pipelines. |

---

## Resources

- [Masthead Documentation](https://docs.mastheadata.com)
- [MCP Integration Guide](https://docs.mastheadata.com/developer/mcp/)
- [Contributing Guidelines](CONTRIBUTING.md)
