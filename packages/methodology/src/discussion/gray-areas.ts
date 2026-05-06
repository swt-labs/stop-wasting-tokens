import type { Calibration, DiscussionContext, GrayArea } from './types.js';

export interface GenerateGrayAreasInput {
  readonly mode: DiscussionContext['mode'];
  readonly context: DiscussionContext;
  readonly calibration: Calibration;
}

export function generateGrayAreas(input: GenerateGrayAreasInput): readonly GrayArea[] {
  switch (input.mode) {
    case 'bootstrap':
      return bootstrapGrayAreas(input.calibration);
    case 'scope':
      return scopeGrayAreas(input.calibration);
    case 'phase':
      return phaseGrayAreas(input.calibration);
  }
}

function bootstrapGrayAreas(calibration: Calibration): readonly GrayArea[] {
  const base: GrayArea[] = [
    {
      id: 'project_name',
      topic: 'Project name',
      prompt: 'What is the project name (kebab-case)?',
      kind: 'text',
      required: true,
    },
    {
      id: 'description',
      topic: 'Project description',
      prompt: 'One-sentence description of the project',
      kind: 'text',
      required: true,
    },
    {
      id: 'core_value',
      topic: 'Core value',
      prompt: 'What problem does this project solve in one sentence? (Optional — defaults to description)',
      kind: 'text',
    },
    {
      id: 'license',
      topic: 'License',
      prompt: 'Which license should this project use?',
      kind: 'choice',
      options: [
        { value: 'mit', label: 'MIT' },
        { value: 'apache-2.0', label: 'Apache 2.0' },
        { value: 'agpl-3.0', label: 'AGPL 3.0' },
        { value: 'proprietary', label: 'Proprietary' },
      ],
      defaultValue: 'mit',
      recommendation: 'mit',
    },
    {
      id: 'target_users',
      topic: 'Target users',
      prompt: 'Who is the primary user?',
      kind: 'choice',
      options: [
        { value: 'just-me', label: 'Just me' },
        { value: 'small-team', label: 'Small team (2-10)' },
        { value: 'org', label: 'Single organisation' },
        { value: 'public', label: 'Public users (100+)' },
      ],
      defaultValue: 'just-me',
    },
  ];

  if (calibration === 'architect') {
    base.push({
      id: 'tech_stack',
      topic: 'Tech stack defaults',
      prompt: 'Which runtime / framework family fits best?',
      kind: 'choice',
      options: [
        { value: 'node-ts', label: 'Node + TypeScript' },
        { value: 'python', label: 'Python' },
        { value: 'rust', label: 'Rust' },
        { value: 'go', label: 'Go' },
        { value: 'other', label: 'Other (specify later)' },
      ],
      defaultValue: 'node-ts',
      recommendation: 'node-ts',
    });
    base.push({
      id: 'deployment',
      topic: 'Deployment surface',
      prompt: 'Where will this run?',
      kind: 'choice',
      options: [
        { value: 'cli', label: 'CLI / local binary' },
        { value: 'web-app', label: 'Web app' },
        { value: 'mobile', label: 'Mobile' },
        { value: 'service', label: 'Long-running service' },
        { value: 'library', label: 'Library / SDK' },
      ],
      defaultValue: 'cli',
    });
  }

  return base;
}

function scopeGrayAreas(calibration: Calibration): readonly GrayArea[] {
  const base: GrayArea[] = [
    {
      id: 'milestone_name',
      topic: 'Milestone name',
      prompt: 'What should this milestone be called?',
      kind: 'text',
      required: true,
    },
    {
      id: 'scope_boundary',
      topic: 'Scope boundary',
      prompt: 'What does this milestone include? What is explicitly out of scope?',
      kind: 'text',
      required: true,
    },
    {
      id: 'decomposition_rationale',
      topic: 'Decomposition rationale',
      prompt: 'How are you grouping work into phases, and why?',
      kind: 'text',
      required: true,
    },
    {
      id: 'phase_count',
      topic: 'Phase count',
      prompt: 'How many phases (3-5 recommended)?',
      kind: 'choice',
      options: [
        { value: '3', label: '3 phases' },
        { value: '4', label: '4 phases' },
        { value: '5', label: '5 phases' },
      ],
      defaultValue: '3',
      recommendation: '3',
    },
  ];

  if (calibration === 'architect') {
    base.push({
      id: 'duration_target',
      topic: 'Duration target',
      prompt: 'Target wall-clock duration for the whole milestone',
      kind: 'choice',
      options: [
        { value: 'days', label: 'Days (sprint)' },
        { value: 'weeks', label: 'Weeks (release cycle)' },
        { value: 'months', label: 'Months (epic)' },
      ],
      defaultValue: 'weeks',
    });
  }

  base.push({
    id: 'deferred_ideas',
    topic: 'Deferred ideas',
    prompt: 'List ideas you considered but want to defer (one per line). Type "defer" to skip.',
    kind: 'text',
  });

  return base;
}

function phaseGrayAreas(calibration: Calibration): readonly GrayArea[] {
  const base: GrayArea[] = [
    {
      id: 'goal_clarity',
      topic: 'Goal clarity',
      prompt: 'Restate this phase goal in one sentence',
      kind: 'text',
      required: true,
    },
    {
      id: 'success_criteria',
      topic: 'Success criteria',
      prompt: 'How will you know the phase is done? (one per line)',
      kind: 'text',
      required: true,
    },
  ];

  if (calibration === 'architect') {
    base.push({
      id: 'risk',
      topic: 'Risk surface',
      prompt: 'What is the top risk for this phase?',
      kind: 'text',
    });
  }

  return base;
}
