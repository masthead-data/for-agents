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

The plugin ships two workflows. Names differ per client:

| Workflow | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Incident triage — open incidents, upstream lineage, blast radius, mitigation plan | `/masthead-agent-tools:triage` | `$masthead-agent-tools:masthead-triage` | `/masthead-triage` |
| FinOps audit — dead-end and unused tables, dataset billing models, pipelines, data models | `/masthead-agent-tools:savings` | `$masthead-agent-tools:masthead-savings` | `/masthead-savings` |

Both accept an optional scope after the name, for example `… savings tables in project my-project`, `… savings datasets`, `… triage incident <uuid>`, `… triage table project.dataset.table`.

---

## For coding agents: setup checklist

If you are an AI coding agent asked to set up Masthead tools, do exactly this:

1. Detect which client you are running in (Claude Code, Codex, Antigravity) and follow only that subsection under [Installation](#installation).
2. Plugins load at startup. After installing, stop and tell the user to **restart the client**.
3. The `masthead` MCP server needs a one-time browser sign-in the user must do: Claude Code `/mcp` → authenticate `masthead`; Codex `codex mcp login masthead`; Antigravity Agent Settings → Customizations → `masthead` → Authenticate. A `401 Unauthorized` from any tool means this step is missing.
4. Tell the user the first command to run after restart: the triage workflow works for every tenant; the FinOps workflow additionally needs the BigQuery insights export enabled (the skill checks this via `get_tenant_settings` and stops with a link if it is not).
5. Do not run any workflow in the session that installed the plugin — it cannot see the plugin yet.

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
- **MCP Server Authentication**: The Masthead MCP server (`https://mcp.mastheadata.com/mcp`) authenticates via Google OAuth 2.0 in your agent client — see the setup checklist above for the per-client command (service account support coming soon).

FinOps skills resolve your insights dataset through the `get_tenant_settings` MCP tool (dataset name, export enabled flag, look-back window). Without MCP, set `MASTHEAD_INSIGHTS_DATASET` or put the dataset into `~/.masthead/config.json` / `.masthead/config.json`; the skill asks once otherwise.

---

## Available Skills

| Skill | Category | Mode | Description |
| --- | --- | --- | --- |
| [`masthead-incident-triaging`](skills/masthead-incident-triaging/) | Observability | MCP | Triage, trace upstream/downstream lineage, assign ownership, and manage live incidents. |
| [`masthead-storage-savings-with-tables`](skills/masthead-storage-savings-with-tables/) | FinOps | Local SQL | Identify and clean up dead-end and unused BigQuery tables. |
| [`masthead-storage-savings-with-datasets`](skills/masthead-storage-savings-with-datasets/) | FinOps | Local SQL | Optimize dataset-level billing models (logical vs. physical) and partition expiration. |
| [`masthead-compute-savings-with-workload-assignments`](skills/masthead-compute-savings-with-workload-assignments/) | FinOps | Local SQL | Rebalance Dataform, dbt, and Airflow model compute between reservations and on-demand. |
| [`masthead-compute-savings-with-pipelines`](skills/masthead-compute-savings-with-pipelines/) | FinOps | Local SQL | Detect and pause legacy, orphaned, or inefficient data pipelines. |

---

## Resources

- [Masthead Documentation](https://docs.mastheadata.com)
- [MCP Integration Guide](https://docs.mastheadata.com/developer/mcp/)
- [Contributing Guidelines](CONTRIBUTING.md)
