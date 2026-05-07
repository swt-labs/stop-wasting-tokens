---
phase: '03'
plan: '02'
title: 'Sample VBW-grade summary'
status: complete
completed: 2026-05-06
tasks_completed: 2
tasks_total: 2
ac_results:
  [
    {
      'id': 'AC1',
      'must_have': 'Lead runs before Dev',
      'status': 'pass',
      'evidence': 'orchestration log shows wave order',
    },
    {
      'id': 'AC2',
      'must_have': 'Disjoint files invariant',
      'status': 'pass',
      'evidence': 'validateDisjointFiles unit test',
    },
  ]
pre_existing_issues: ['leftover TODO comment in plan.ts']
commit_hashes: ['a1b2c3d', 'e4f5a6b']
files_modified: ['packages/methodology/src/vibe/handlers/plan.ts']
deviations:
  [
    {
      'id': 'D1',
      'type': 'scope',
      'description': 'Skipped milestone-level retry',
      'rationale': 'Out of scope for this plan',
    },
  ]
---

# Phase 3 / Plan 02 — Summary

Body content goes here.
