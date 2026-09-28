#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const proportion = (numerator, denominator) => denominator ? numerator / denominator : null;

/** Preserve unknown denominators and distinguish graded rate from conservative all-run rate. */
export function summarizeReports(reports) {
  const seen = new Set();
  for (const report of reports) {
    if (!report.runId || seen.has(report.runId)) throw new Error(`Missing or duplicate runId: ${report.runId}`);
    seen.add(report.runId);
    if (!['pass', 'fail', 'ungraded', 'error'].includes(report.status)) throw new Error(`Invalid report status: ${report.status}`);
  }
  const groups = new Map();
  for (const report of reports) {
    const metadata = report.generationMetadata ?? {};
    // A requested model name is never used as an observed model identity.
    const model = metadata.observedModel && metadata.modelEvidence ? metadata.observedModel : 'unverified';
    const key = JSON.stringify([metadata.arm ?? 'unspecified', report.kind, model]);
    if (!groups.has(key)) groups.set(key, { arm: metadata.arm ?? 'unspecified', kind: report.kind, observedModel: model, reports: [] });
    groups.get(key).reports.push(report);
  }
  return {
    version: 1, generatedAt: new Date().toISOString(), totalRuns: reports.length,
    caveats: ['These are browser evaluation denominators; generation attempts without a report must be reconciled from the generation manifest.',
      'No success rate is reported for zero graded runs. Unknown outcomes are retained in the all-run denominator.',
      'Model identity and generation timing/cost are caller-supplied metadata with source evidence, not browser measurements.',
      'Repeated seeds and a balanced paired baseline/treatment design are needed before inferring model or engine improvement.'],
    groups: [...groups.values()].map(({ reports: runs, ...group }) => {
      const counts = Object.fromEntries(['pass', 'fail', 'ungraded', 'error'].map((status) => [status, runs.filter((run) => run.status === status).length]));
      const graded = counts.pass + counts.fail;
      const editComparisons = runs.filter((run) => run.kind === 'edit' && ['pass', 'fail'].includes(run.editRegression?.status));
      const regressions = editComparisons.filter((run) => run.editRegression.status === 'fail');
      return { ...group, total: runs.length, ...counts, graded,
        gradedSuccessRate: proportion(counts.pass, graded),
        confirmedSuccessRateAllRuns: proportion(counts.pass, runs.length),
        gradeCoverage: proportion(graded, runs.length),
        runtimePasses: runs.filter((run) => run.browserStatus === 'pass').length,
        requestedBehaviorPasses: runs.filter((run) => run.requestedBehaviorStatus === 'pass').length,
        visualReviewPasses: runs.filter((run) => run.visualReviewStatus === 'pass').length,
        comparableEditRuns: editComparisons.length, editRegressionRuns: regressions.length,
        editRegressionRate: proportion(regressions.length, editComparisons.length),
        runIds: runs.map((run) => run.runId),
      };
    }),
  };
}

async function main() {
  const filenames = process.argv.slice(2);
  let output;
  const outputIndex = filenames.indexOf('--output');
  if (outputIndex >= 0) { output = filenames[outputIndex + 1]; filenames.splice(outputIndex, 2); }
  if (!filenames.length) throw new Error('Usage: node benchmarks/summarize.mjs report.json [report.json ...] [--output summary.json]');
  const summary = summarizeReports(await Promise.all(filenames.map(async (filename) => JSON.parse(await readFile(resolve(filename), 'utf8')))));
  const json = `${JSON.stringify(summary, null, 2)}\n`;
  if (output) await writeFile(resolve(output), json);
  else process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
}
