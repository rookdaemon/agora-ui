import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

export function Input({ value, onChange, onSubmit }: InputProps): JSX.Element {
  return (
    <Box borderStyle="single" borderColor="blue" paddingX={1}>
      <Text color="blue">&gt; </Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder="Type message (@peer for DM, /help for commands)"
      />
    </Box>
  );
}
