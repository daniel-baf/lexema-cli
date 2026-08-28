import React from 'react';
import { Text } from 'ink';

export default function Header({ model, host }: { model: string; host: string }) {
  return (
    <Text>
      <Text bold color="cyan">
        ● lexema
      </Text>
      <Text dimColor>
        {'  '}
        {model} · {host}
      </Text>
    </Text>
  );
}
