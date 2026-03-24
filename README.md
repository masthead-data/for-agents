# Masthead Agent Skills

A curated collection of Agent Skills for working with [Masthead Data](https://mastheadata.com) — BigQuery data observability and cost optimization for Google Cloud.

## Prerequisites

Before installing, make sure you have:

- **A Masthead Data account** with a provisioned insights dataset. [Request access →](https://docs.mastheadata.com/api#get-access-to-bigquery-resources)
- **`gcloud` CLI** authenticated (`gcloud auth login`)
- **`bq` CLI** available (`bq version` to verify)
- **BigQuery permissions**: ability to run jobs and read data in your project

When a skill runs for the first time it will ask you for your Masthead insights dataset ID (e.g. `my-project.masthead_insights`). It stores this in your project's instructions file so you won't be prompted again.

## Installation & Usage

These skills are designed to be consumed directly by AI agents such as Claude Code or GitHub Copilot.

### Claude Code

Add the Masthead plugin to your Claude Code tools configuration ([about Claude Code plugins](https://code.claude.com/docs/en/discover-plugins#install-plugins)):

```text
/plugin marketplace add masthead-data/for-agents
/plugin install masthead-data-skills@masthead-data
/reload-plugins
```

### GitHub Copilot / Vercel Skills CLI

Use the [Vercel Skills CLI](https://github.com/vercel-labs/skills) to install skills directly into your project:

```bash
# Install all skills globally (available in all projects)
npx skills add masthead-data/for-agents --global

# Install a specific skill
npx skills add masthead-data/for-agents --skill optimize-storage-costs
```

Once installed, ask your agent naturally:

```text
Optimize my BigQuery storage costs using Masthead insights
```

## Available Skills

### `optimize-data-model-compute`
Optimize BigQuery compute costs by assigning Dataform, dbt, or Airflow models to slot reservations or on-demand compute.

**What you get:** updated reservation assignment config for your orchestration tool (Dataform, dbt or Airflow), verified against live Masthead recommendations.

### `optimize-storage-costs`
Optimize BigQuery storage costs by identifying and removing dead-end and unused tables.

**What you get:** a reviewed CSV of waste candidates ranked by savings impact, and a ready-to-run shell script to drop approved tables.

---

## Resources

- [Masthead Documentation](https://docs.mastheadata.com)
