#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateCase } from './evaluate.mjs';

const manifest = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const rows = manifest.cases.map((item) => {
  const creation = item.stages.find((stage) => stage.kind === 'oneshot');
  const edits = item.stages.filter((stage) => stage.kind === 'edit');
  for (const stage of [creation, ...edits]) validateCase(manifest, item.id, stage.id);
  return { name: item.id, prompt: item.prompt, edits: edits.map((stage) => stage.prompt), platform: 'desktop',
    checks: [creation, ...edits].map((stage) => ({ case: item.id, stage: stage.id })) };
});
const content = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
if (process.argv[2]) await writeFile(resolve(process.argv[2]), content);
else process.stdout.write(content);
