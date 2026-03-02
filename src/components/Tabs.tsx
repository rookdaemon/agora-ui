import React from 'react';
import { Box, Text } from 'ink';

export interface TabItem {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
}

export function Tabs({ tabs, activeTab }: TabsProps): JSX.Element {
  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1}>
      {tabs.map((tab, i) => (
        <Box key={tab.id} marginRight={i < tabs.length - 1 ? 1 : 0}>
          <Text
            bold={tab.id === activeTab}
            color={tab.id === activeTab ? 'cyan' : undefined}
            dimColor={tab.id !== activeTab}
          >
            [{tab.label}]
          </Text>
        </Box>
      ))}
      <Box flexGrow={1} />
      <Text dimColor>Tab to switch</Text>
    </Box>
  );
}
