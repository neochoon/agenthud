import React from "react";
import { Box, Text } from "ink";
import { PANEL_WIDTH } from "./constants.js";

export function WelcomePanel(): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={PANEL_WIDTH}>
      {/* Header */}
      <Box marginTop={-1}>
        <Text> Welcome to agenthud </Text>
      </Box>

      <Text> </Text>
      <Text>  No .agent/ directory found.</Text>
      <Text> </Text>
      <Text>  Quick setup:</Text>
      <Text color="cyan">     npx agenthud init</Text>
      <Text> </Text>
      <Text dimColor>  Or visit: github.com/neochoon/agenthud</Text>
      <Text> </Text>
      <Text dimColor>  Press q to quit</Text>
    </Box>
  );
}
