import React from 'react';
import { Text } from 'ink';

export default function InputBox({
  value,
  cursor,
  busy,
  placeholder,
}: {
  value: string;
  cursor: number;
  busy: boolean;
  placeholder: string;
}) {
  return (
    <Text>
      <Text bold color={busy ? 'gray' : 'green'}>
        ❯{' '}
      </Text>
      {value.length === 0 && !busy ? (
        <Text dimColor>{placeholder}</Text>
      ) : (
        <Text>
          {value.slice(0, cursor)}
          <Text color={busy ? 'gray' : 'cyan'}>{busy ? '…' : '▌'}</Text>
          {value.slice(cursor)}
        </Text>
      )}
    </Text>
  );
}
