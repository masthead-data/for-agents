# Masthead Agent Skills

A curated collection of [Agent Skills](https://agentskills.io/home) for working with [Masthead Data](https://mastheadata.com) — BigQuery cost observability and FinOps for Google Cloud. These skills help AI agents understand BigQuery slot economics, reservation strategies, and cost optimization workflows more accurately and efficiently.

## What are Agent Skills?

Agent Skills are folders of instructions and resources that agents discover and use automatically — they are **not** slash commands or user-invoked actions. Once installed, Claude loads the relevant skill when your prompt matches its use case. Just describe what you need in natural language.

## What's Included

- **Compute cost optimization**: Identify slot waste, diagnose cost spikes, and surface actionable savings recommendations
- **Storage cost optimization**: Find the optimal storage billing model and reduce storage spend across your BigQuery environment
- **Reservation analysis**: Model commitment vs. on-demand tradeoffs and right-size your slot reservations

## Prerequisites

- A [Masthead Data](https://mastheadata.com) account
- BigQuery access with `INFORMATION_SCHEMA` read permissions

---

## Installation

### Claude Code

Add the Masthead skills marketplace and install the plugin:

```
/plugin marketplace add masthead-data/masthead-agent-skills
/plugin install masthead@masthead-agent-skills
```

Claude will prompt you to choose an install scope:

| Scope | Where files land | Best for |
|---|---|---|
| **User (global)** | `~/.claude/plugins/masthead/` | Individual developers — available in every project |
| **Project** | `.claude/plugins/masthead/` | Teams — commit to git, auto-installs for collaborators |
| **Local** | `.claude/plugins/masthead/` | Personal, gitignored — this repo only |

> **Team tip:** Choose **Project** scope and commit `.claude/settings.json` to your repository. Every teammate who clones the repo will be prompted to install Masthead skills automatically.

### Other AI Clients (Cursor, Cline, GitHub Copilot, and 30+ others)

Use the [Vercel Skills CLI](https://github.com/vercel-labs/skills):

```bash
# Preview available skills
npx skills add masthead-data/masthead-agent-skills --list

# Install all skills
npx skills add masthead-data/masthead-agent-skills

# Install a specific skill
npx skills add masthead-data/masthead-agent-skills --skill optimize-bq-compute-costs

# Install globally (available in all projects)
npx skills add masthead-data/masthead-agent-skills --global

# Keep skills up to date
npx skills update
```

---

## Available Skills

### `optimize-bq-compute-costs`

Identifies BigQuery compute cost inefficiencies and surfaces concrete savings recommendations. Use when you want to understand why your BigQuery spend increased, find wasteful query patterns, or get prioritized actions to reduce costs.

**Triggers on prompts like:**
- *"Why did our BigQuery costs spike this week?"*
- *"Which jobs are consuming the most slots?"*
- *"Find wasteful queries in our project"*
- *"How can we reduce our BigQuery bill?"*
- *"Which tables are written to but never read?"*

**What the agent does:**
Queries Masthead's shared BigQuery dataset — pre-populated with insights about your environment — to retrieve cost analytics, slot utilization trends, and anomaly signals. Surfaces top cost drivers by user, job type, and time window. Identifies anti-patterns like full table scans, missing partition filters, and repeated identical queries. Detects dead-end tables and pipelines — datasets and jobs that consume slots and storage but whose outputs are never read downstream — so you can eliminate waste at the source.

---

### `optimize-bq-storage-costs`

Identifies BigQuery storage inefficiencies and surfaces recommendations to reduce storage spend. Use when you want to understand what's driving your storage bill or find the optimal storage billing model for your datasets.

**Triggers on prompts like:**
- *"What's driving our BigQuery storage costs?"*
- *"Should we switch to physical storage billing?"*
- *"Which datasets would be cheaper with logical vs physical billing?"*
- *"How can we reduce our BigQuery storage bill?"*

**What the agent does:**
Queries Masthead's shared BigQuery dataset — pre-populated with insights about your environment — to retrieve storage utilization insights. Surfaces oversized tables and stale datasets, and recommends the optimal storage billing model — physical or logical — for each dataset based on your actual data characteristics, showing the projected cost difference between the two.

---

### `reservation-analysis`

Models BigQuery slot reservation strategies and commitment economics. Use when evaluating whether to purchase commitments, resize existing reservations, or understand the tradeoff between flat-rate and on-demand pricing.

**Triggers on prompts like:**
- *"Should we buy more slot commitments?"*
- *"Are our current reservations the right size?"*
- *"Compare flex vs. standard slot commitments for our workload"*
- *"Model what happens if we move team X to on-demand"*

**What the agent does:**
Queries Masthead's shared BigQuery dataset — pre-populated with insights about your environment — to retrieve historical slot utilization, commitment coverage, and workload distribution data. Surfaces right-sizing recommendations with projected monthly savings.

---

## How Skills Work

Skills use a three-stage progressive disclosure model to keep your agent's context window lean:

1. **Advertise** (~100 tokens) — skill names and descriptions are injected at startup so the agent knows what's available
2. **Load** (<5,000 tokens) — when your prompt matches, the agent loads the full `SKILL.md` instructions
3. **Read resources** (on demand) — supplementary reference files are fetched only when needed

This means even with all three skills installed, the overhead at the start of every session is minimal.

---

## Compatible Agents

These skills follow the [Agent Skills specification](https://agentskills.io/specification) and work with any compatible agent, including:

- Claude Code
- Cursor
- Cline
- GitHub Copilot (with skills support)
- Windsurf
- And [30+ others](https://agentskills.io/home)

---

## Resources

- [Masthead Documentation](https://docs.mastheadata.com)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Agent Skills Documentation](https://agentskills.io/home)

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
