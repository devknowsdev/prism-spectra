#!/usr/bin/env -S tsx
/* One-shot script: run a single task node against the current repo workDir
   and print the checkpoint diff. Intended for applying an approved preview.
*/
import { ExecutionEngine } from "../src/index.js";
import { TaskGraph } from "../src/taskGraph/graph.js";

async function main() {
  const graph = {
    id: 'apply-readme-1',
    projectId: 'dashboard',
    nodes: [
      {
        id: 'backend',
        packet: {
          intent: 'Create README with a short summary',
          node_type: 'backend',
          constraints: [],
          filePaths: ['README.md'],
          context: {
            targetFile: 'README.md',
            template: 'Write a concise README with a one-line summary and a short description.'
          },
          dependencies: [],
        },
      },
    ],
  } as any;

  const inputs = (graph.nodes || []).map((n: any) => ({ id: n.id, packet: n.packet }));
  const tg = new TaskGraph(graph.id, graph.projectId, inputs);

  const engine = new ExecutionEngine({ dbPath: '.demo/real-apply.db', workDir: process.cwd(), mockExecutors: false, fallbackOnFailure: false });
  await engine.init();
  try {
    console.log('Running node(s) in', process.cwd());
    const logs = await engine.run(tg, 'sequential');
    console.log('Run logs:\n', JSON.stringify(logs, null, 2));
    try {
      const diff = await engine.checkpoints.diff('backend');
      console.log('\n--- APPLIED DIFF FOR node:backend ---\n');
      console.log(diff);
    } catch (e) {
      console.error('Could not read diff for node backend:', e?.message ?? e);
    }
  } finally {
    engine.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
