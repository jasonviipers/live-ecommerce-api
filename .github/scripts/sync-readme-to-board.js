import { readFileSync } from 'fs';
import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

const MyOctokit = Octokit.plugin(throttling);
const octokit = new MyOctokit({
  auth: process.env.GH_PROJECT_TOKEN,
  throttle: { onRateLimit, onSecondaryRateLimit },
});

const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const readme = readFileSync('README.md', 'utf8');

/* ---------- helpers ---------- */
function parseSections() {
  const re = /^## ([^\n]+)([\s\S]*?)(?=\n## |\n# |$)/gm;
  const tasks = [];
  let m;
  while ((m = re.exec(readme)) !== null) {
    const title = m[1].replace(/^[^\w]+/, '').trim();
    if (['Prerequisites', 'Quick Start', 'Deployment', 'Support'].includes(title)) continue;

    // every bullet is treated as a task
    const bullets = [...m[2].matchAll(/^- \*\*(.+?)\*\* - (.+)/gm)].map(b => ({
      title: b[1],
      body: b[2],
      section: title,
    }));
    tasks.push(...bullets);
  }
  return tasks;
}

/* ---------- sync ---------- */
async function sync() {
  // find project
  const { data: projects } = await octokit.rest.projects.listForRepo({ owner, repo, state: 'open' });
  const proj = projects.find(p => p.name.includes('Roadmap'));
  if (!proj) throw new Error('Project not found');

  // fetch existing cards
  const { data: columns } = await octokit.rest.projects.listColumns({ project_id: proj.id });
  const todoCol = columns.find(c => c.name.toLowerCase() === 'todo');
  const doneCol = columns.find(c => c.name.toLowerCase() === 'done');

  const { data: cards } = await octokit.rest.projects.listCards({ column_id: todoCol.id });
  const existing = cards.map(c => c.note || c.content_url);

  for (const t of parseSections()) {
    const issueTitle = `[${t.section}] ${t.title}`;
    if (existing.some(e => e.includes(issueTitle))) continue;

    const { data: issue } = await octokit.rest.issues.create({
      owner, repo, title: issueTitle, body: t.body,
      labels: ['auto-roadmap', t.section.toLowerCase()],
    });

    await octokit.rest.projects.createCard({
      column_id: todoCol.id, content_id: issue.id, content_type: 'Issue',
    });
  }
}

sync().catch(console.error);