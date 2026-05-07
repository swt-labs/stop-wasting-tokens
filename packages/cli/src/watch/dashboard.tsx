import React from 'react';
import { Box, Text } from 'ink';

import type { WatchViewModel } from './state.js';

export interface DashboardProps {
  readonly state: WatchViewModel;
}

function qaColor(status: string): 'red' | 'yellow' | 'green' | undefined {
  switch (status) {
    case 'failed':
      return 'red';
    case 'pending':
    case 'remediating':
      return 'yellow';
    case 'passed':
    case 'remediated':
      return 'green';
    default:
      return undefined;
  }
}

function uatColor(issues: number, file: string | undefined): 'red' | 'green' | undefined {
  if (issues > 0) return 'red';
  if (file !== undefined) return 'green';
  return undefined;
}

export const Dashboard: React.FC<DashboardProps> = ({ state }) => {
  const { project, milestone, phase, plans, qa, uat, activity } = state;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold>{project}</Text>
        {milestone.length > 0 ? <Text> — {milestone}</Text> : null}
      </Box>

      <Box marginTop={1}>
        <Text>
          Phase {phase.number || '—'}: {phase.slug || 'no active phase'}
        </Text>
      </Box>
      <Box>
        <Text dimColor>State: </Text>
        <Text>{phase.state}</Text>
      </Box>

      <Box marginTop={1}>
        <Text>Plans: </Text>
        <Text bold>
          {plans.summaries}/{plans.total}
        </Text>
      </Box>

      <Box>
        <Text>QA: </Text>
        {(() => {
          const c = qaColor(qa.status);
          return c !== undefined ? <Text color={c}>{qa.status}</Text> : <Text>{qa.status}</Text>;
        })()}
        {qa.round !== undefined ? <Text dimColor> (round {qa.round})</Text> : null}
      </Box>

      <Box>
        <Text>UAT: </Text>
        {(() => {
          const c = uatColor(uat.issues, uat.file);
          const label =
            uat.file !== undefined ? `${uat.file} — ${uat.issues} issues` : `${uat.issues} issues`;
          return c !== undefined ? <Text color={c}>{label}</Text> : <Text>{label}</Text>;
        })()}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Recent activity</Text>
        {activity.length === 0 ? (
          <Text dimColor>(no commits yet)</Text>
        ) : (
          activity.map((commit) => (
            <Box key={commit.hash}>
              <Text dimColor>{commit.hash.slice(0, 7)} </Text>
              <Text>{commit.subject}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};
