import { readFileSync } from 'fs';
import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

// Define rate limit handlers
const onRateLimit = (retryAfter, options, octokit) => {
  console.warn(`Request quota exhausted for request ${options.method} ${options.url}`);
  if (options.request.retryCount === 0) {
    console.log(`Retrying after ${retryAfter} seconds!`);
    return true;
  }
};

const onSecondaryRateLimit = (retryAfter, options, octokit) => {
  console.warn(`Secondary rate limit triggered for request ${options.method} ${options.url}`);
  if (options.request.retryCount === 0) {
    console.log(`Retrying after ${retryAfter} seconds!`);
    return true;
  }
};

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
  try {
    // find project
    const { data: projects } = await octokit.rest.projects.listForRepo({ owner, repo, state: 'open' });
    const proj = projects.find(p => p.name.includes('Roadmap'));
    if (!proj) {
      console.log('No project found with "Roadmap" in name. Available projects:');
      projects.forEach(p => console.log(`- ${p.name}`));
      throw new Error('Project not found');
    }

    // fetch existing cards
    const { data: columns } = await octokit.rest.projects.listColumns({ project_id: proj.id });
    const todoCol = columns.find(c => c.name.toLowerCase() === 'todo');
    const doneCol = columns.find(c => c.name.toLowerCase() === 'done');
    
    if (!todoCol) {
      console.log('No "todo" column found. Available columns:');
      columns.forEach(c => console.log(`- ${c.name}`));
      throw new Error('Todo column not found');
    }

    const { data: cards } = await octokit.rest.projects.listCards({ column_id: todoCol.id });
    const existing = cards.map(c => c.note || c.content_url);

    const tasks = parseSections();
    console.log(`Found ${tasks.length} tasks in README.md`);

    for (const t of tasks) {
      const issueTitle = `[${t.section}] ${t.title}`;
      if (existing.some(e => e.includes(issueTitle))) {
        console.log(`Skipping existing task: ${issueTitle}`);
        continue;
      }

      console.log(`Creating issue: ${issueTitle}`);
      const { data: issue } = await octokit.rest.issues.create({
        owner, 
        repo, 
        title: issueTitle, 
        body: t.body,
        labels: ['auto-roadmap', t.section.toLowerCase()],
      });

      console.log(`Creating card for issue #${issue.number}`);
      await octokit.rest.projects.createCard({
        column_id: todoCol.id, 
        content_id: issue.id, 
        content_type: 'Issue',
      });
    }

    console.log('Sync completed successfully!');
  } catch (error) {
    console.error('Error during sync:', error);
    throw error;
  }
}

sync().catch(console.error);