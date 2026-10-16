#!/usr/bin/env node
/**
 * READ-ONLY. Snapshots every case's workflow progress for one organization,
 * or compares two snapshots — used before and after a production deployment
 * to prove no existing case lost checklist progress or moved backwards.
 *
 *   node scripts/case-progress-snapshot.mjs snapshot managed-cremations > before.json
 *   node scripts/case-progress-snapshot.mjs snapshot managed-cremations > after.json
 *   node scripts/case-progress-snapshot.mjs compare before.json after.json
 *
 * Reads WIX_API_KEY / WIX_SITE_ID from the environment (or .env.local). Only
 * ever calls the Wix Data QUERY endpoint; it writes nothing. Output carries
 * case numbers and progress only — no names or other personal data.
 */
import fs from 'node:fs';

function env(key) {
  if (process.env[key]) return process.env[key];
  if (!fs.existsSync('.env.local')) return undefined;
  const line = fs.readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).replace(/^["']|["']$/g, '');
}

async function snapshot(organizationId) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch('https://www.wixapis.com/wix-data/v2/items/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: env('WIX_API_KEY'), 'wix-site-id': env('WIX_SITE_ID') },
      body: JSON.stringify({ dataCollectionId: 'cases', query: { filter: { organizationId }, paging: { limit: 100, offset } } }),
    });
    if (!response.ok) throw new Error(`Wix query failed (HTTP ${response.status})`);
    const body = await response.json();
    rows.push(...body.dataItems.map((item) => item.data));
    if (body.dataItems.length < 100) break;
  }
  return rows
    .map((row) => ({
      caseNumber: row.caseNumber,
      currentStage: row.currentStage,
      workflowTemplateVersion: row.workflowTemplateVersion,
      isArchived: row.isArchived,
      paymentStatus: row.paymentStatus,
      revision: typeof row.revision === 'number' ? row.revision : null,
      completedChecklistKeys: Object.entries(row.checklistState ?? {})
        .filter(([, done]) => done === true)
        .map(([key]) => key)
        .sort(),
    }))
    .sort((a, b) => String(a.caseNumber).localeCompare(String(b.caseNumber)));
}

function compare(beforeFile, afterFile) {
  const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
  const after = new Map(JSON.parse(fs.readFileSync(afterFile, 'utf8')).map((c) => [c.caseNumber, c]));
  const problems = [];
  for (const b of before) {
    const a = after.get(b.caseNumber);
    if (!a) {
      problems.push(`${b.caseNumber}: missing after deployment`);
      continue;
    }
    if (a.currentStage < b.currentStage) problems.push(`${b.caseNumber}: stage moved BACK ${b.currentStage} -> ${a.currentStage}`);
    const lost = b.completedChecklistKeys.filter((key) => !a.completedChecklistKeys.includes(key));
    if (lost.length) problems.push(`${b.caseNumber}: completed checklist items no longer completed: ${lost.join(', ')}`);
    if (a.workflowTemplateVersion !== b.workflowTemplateVersion) problems.push(`${b.caseNumber}: workflow version changed ${b.workflowTemplateVersion} -> ${a.workflowTemplateVersion}`);
    if (b.paymentStatus === 'paid_in_full' && a.paymentStatus !== 'paid_in_full') problems.push(`${b.caseNumber}: no longer paid`);
  }
  console.log(problems.length ? problems.join('\n') : `OK — ${before.length} cases checked: no progress lost, no stage moved back, no workflow version changed.`);
  process.exitCode = problems.length ? 1 : 0;
}

const [command, a, b] = process.argv.slice(2);
if (command === 'snapshot' && a) console.log(JSON.stringify(await snapshot(a), null, 2));
else if (command === 'compare' && a && b) compare(a, b);
else {
  console.error('usage: snapshot <organizationId> | compare <before.json> <after.json>');
  process.exitCode = 2;
}
