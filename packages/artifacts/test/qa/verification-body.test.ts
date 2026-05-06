import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  parseVerificationBody,
  readVerification,
  renderVerificationBody,
  writeVerification,
  type VerificationDoc,
} from '../../src/qa/verification.js';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swt-verification-body-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseVerificationBody — multi-section', () => {
  it('extracts every VBW section table from the fixture', async () => {
    const raw = await readFile(join(FIXTURE_DIR, 'vbw-verification-multi-section.md'), 'utf8');
    // Drop the frontmatter to feed parseVerificationBody just the body.
    const body = raw.replace(/^---[\s\S]*?\n---\n+/, '');
    const out = parseVerificationBody(body);
    expect(out.layout).toBe('vbw');
    expect(out.checks).toHaveLength(2);
    expect(out.artifact_checks).toHaveLength(2);
    expect(out.key_link_checks).toHaveLength(1);
    expect(out.anti_pattern_checks).toHaveLength(1);
    expect(out.convention_checks).toHaveLength(1);
    expect(out.requirement_mapping).toHaveLength(2);
    expect(out.requirement_mapping[0]?.req).toBe('REQ-06');
  });

  it('round-trips the fixture through readVerification + writeVerification', async () => {
    const raw = await readFile(join(FIXTURE_DIR, 'vbw-verification-multi-section.md'), 'utf8');
    await writeFile(join(dir, '03-VERIFICATION.md'), raw, 'utf8');
    const doc = await readVerification(dir, '03');
    expect(doc.layout).toBe('vbw');
    expect(doc.artifact_checks).toHaveLength(2);

    // Re-render with the same body.
    await writeVerification({
      phaseDir: dir,
      doc: { ...doc, body: '' }, // force re-render via renderVerificationBody
    });
    const reread = await readVerification(dir, '03');
    expect(reread.checks).toEqual(doc.checks);
    expect(reread.artifact_checks).toEqual(doc.artifact_checks);
    expect(reread.key_link_checks).toEqual(doc.key_link_checks);
    expect(reread.requirement_mapping).toEqual(doc.requirement_mapping);
  });
});

describe('renderVerificationBody — backwards compat', () => {
  it('renders the SWT single-table layout when layout=swt', () => {
    const doc: VerificationDoc = {
      phase: '01',
      tier: 'standard',
      result: 'pass',
      passed: 1,
      failed: 0,
      total: 1,
      date: '2026-05-06',
      plans_verified: ['01'],
      verified_at_commit: 'abc',
      checks: [{ id: 'AC1', must_have: 'thing', status: 'pass', evidence: 'evidence' }],
      artifact_checks: [],
      key_link_checks: [],
      anti_pattern_checks: [],
      convention_checks: [],
      requirement_mapping: [],
      pre_existing_issues: [],
      layout: 'swt',
      body: '',
    };
    const body = renderVerificationBody(doc);
    expect(body).toContain('## Must-Have Checks');
    expect(body).not.toContain('## Artifact Checks');
  });

  it('renders multi-section layout when layout=vbw', () => {
    const doc: VerificationDoc = {
      phase: '02',
      tier: 'standard',
      result: 'pass',
      passed: 2,
      failed: 0,
      total: 2,
      date: '2026-05-06',
      plans_verified: ['01'],
      verified_at_commit: 'abc',
      checks: [{ id: 'AC1', must_have: 'a', status: 'pass', evidence: 'e' }],
      artifact_checks: [{ id: 'AR1', artifact: 'src/x.ts', status: 'pass', evidence: 'e' }],
      key_link_checks: [],
      anti_pattern_checks: [],
      convention_checks: [],
      requirement_mapping: [],
      pre_existing_issues: [],
      layout: 'vbw',
      body: '',
    };
    const body = renderVerificationBody(doc);
    expect(body).toContain('## Must-Have Checks');
    expect(body).toContain('## Artifact Checks');
  });
});
