import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  sentHistory?: string[];
}

export function Input({ value, onChange, onSubmit, sentHistory = [] }: InputProps): JSX.Element {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draft = useRef('');

  const getHistoryEntry = (index: number): string => sentHistory[sentHistory.length - 1 - index];

  useInput((_input, key) => {
    if (key.upArrow) {
      if (sentHistory.length === 0) return;
      if (historyIndex === -1) {
        draft.current = value;
      }
      const newIndex = Math.min(historyIndex + 1, sentHistory.length - 1);
      setHistoryIndex(newIndex);
      onChange(getHistoryEntry(newIndex));
    } else if (key.downArrow) {
      if (historyIndex === -1) return;
      if (historyIndex === 0) {
        setHistoryIndex(-1);
        onChange(draft.current);
      } else {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        onChange(getHistoryEntry(newIndex));
      }
    }
  });

  const handleSubmit = (val: string) => {
    setHistoryIndex(-1);
    draft.current = '';
    onSubmit(val);
  };

  return (
    <Box borderStyle="single" borderColor="blue" paddingX={1}>
      <Text color="blue">&gt; </Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={handleSubmit}
        placeholder="Type message (@peer for DM, /help for commands)"
      />
    </Box>
  );
}
