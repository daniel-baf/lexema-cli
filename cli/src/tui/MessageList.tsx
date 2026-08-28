import React from 'react';
import { Box, Text } from 'ink';

export interface Entry {
  role: 'user' | 'assistant' | 'error';
  content: string;
}

const LABELS: Record<Entry['role'], { text: string; color: string }> = {
  user: { text: 'you', color: 'green' },
  assistant: { text: 'lexema', color: 'cyan' },
  error: { text: 'error', color: 'red' },
};

export function MessageRow({ entry }: { entry: Entry }) {
  const label = LABELS[entry.role];
  return (
    <Box flexDirection="row" width="100%">
      <Box flexShrink={0} width={8}>
        <Text bold color={label.color}>
          {label.text}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap" color={entry.role === 'error' ? 'red' : undefined}>
          {entry.content}
        </Text>
      </Box>
    </Box>
  );
}
