import React from "react";
import { Box, Text } from "ink";
import type { ProjectData } from "../data/project.js";
import {
  DEFAULT_PANEL_WIDTH,
  BOX,
  createTitleLine,
  createBottomLine,
  padLine,
  getInnerWidth,
} from "./constants.js";

interface ProjectPanelProps {
  data: ProjectData;
  countdown?: number | null;
  width?: number;
  isRunning?: boolean;
  justRefreshed?: boolean;
}

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const padded = String(seconds).padStart(2, " ");
  return `↻ ${padded}s`;
}

function formatLineCount(count: number): string {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + "k";
  }
  return String(count);
}

export function ProjectPanel({
  data,
  countdown,
  width = DEFAULT_PANEL_WIDTH,
  isRunning = false,
  justRefreshed = false,
}: ProjectPanelProps): React.ReactElement {
  const countdownSuffix = isRunning ? "running..." : formatCountdown(countdown);
  const innerWidth = getInnerWidth(width);

  // Error state
  if (data.error) {
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Project", countdownSuffix, width)}</Text>
        <Text>
          {BOX.v}
          <Text color="red">{padLine(" " + data.error, width)}</Text>
          {BOX.v}
        </Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  // Build header: name · language · license
  const headerParts: string[] = [data.name];
  if (data.language) {
    headerParts.push(data.language);
  }
  if (data.license) {
    headerParts.push(data.license);
  }
  const headerText = headerParts.join(" · ");
  const headerPadding = Math.max(0, innerWidth - 1 - headerText.length);

  // Stack line
  const hasStack = data.stack.length > 0;
  const stackText = hasStack ? `Stack: ${data.stack.join(", ")}` : "";
  const stackPadding = Math.max(0, innerWidth - 1 - stackText.length);

  // Files and lines line
  const filesText = `Files: ${data.fileCount} ${data.fileExtension}`;
  const linesText = `Lines: ${formatLineCount(data.lineCount)}`;
  const filesLinesText = `${filesText} · ${linesText}`;
  const filesLinesPadding = Math.max(0, innerWidth - 1 - filesLinesText.length);

  // Dependencies line
  let depsText = "Deps: ";
  if (data.prodDeps > 0 && data.devDeps > 0) {
    depsText += `${data.prodDeps} prod · ${data.devDeps} dev`;
  } else if (data.prodDeps > 0) {
    depsText += `${data.prodDeps}`;
  } else if (data.devDeps > 0) {
    depsText += `${data.devDeps} dev`;
  } else {
    depsText += "0";
  }
  const depsPadding = Math.max(0, innerWidth - 1 - depsText.length);

  // Determine countdown color
  const countdownColor = justRefreshed ? "green" : undefined;

  return (
    <Box flexDirection="column" width={width}>
      {/* Title line */}
      <Text>{createTitleLine("Project", countdownSuffix, width)}</Text>

      {/* Header: name · language · license */}
      <Text>
        {BOX.v}{" "}
        <Text bold>{data.name}</Text>
        {data.language && (
          <>
            <Text dimColor> · </Text>
            <Text color="cyan">{data.language}</Text>
          </>
        )}
        {data.license && (
          <>
            <Text dimColor> · </Text>
            <Text>{data.license}</Text>
          </>
        )}
        {" ".repeat(headerPadding)}
        {BOX.v}
      </Text>

      {/* Stack line (only if has stack) */}
      {hasStack && (
        <Text>
          {BOX.v}{" "}
          <Text dimColor>Stack:</Text>{" "}
          <Text>{data.stack.join(", ")}</Text>
          {" ".repeat(stackPadding)}
          {BOX.v}
        </Text>
      )}

      {/* Files and Lines */}
      <Text>
        {BOX.v}{" "}
        <Text dimColor>Files:</Text>{" "}
        <Text>
          {data.fileCount} {data.fileExtension}
        </Text>
        <Text dimColor> · </Text>
        <Text dimColor>Lines:</Text>{" "}
        <Text>{formatLineCount(data.lineCount)}</Text>
        {" ".repeat(filesLinesPadding)}
        {BOX.v}
      </Text>

      {/* Dependencies */}
      <Text>
        {BOX.v}{" "}
        <Text dimColor>Deps:</Text>{" "}
        {data.prodDeps > 0 && data.devDeps > 0 ? (
          <>
            <Text>{data.prodDeps} prod</Text>
            <Text dimColor> · </Text>
            <Text>{data.devDeps} dev</Text>
          </>
        ) : data.prodDeps > 0 ? (
          <Text>{data.prodDeps}</Text>
        ) : data.devDeps > 0 ? (
          <Text>{data.devDeps} dev</Text>
        ) : (
          <Text>0</Text>
        )}
        {" ".repeat(depsPadding)}
        {BOX.v}
      </Text>

      {/* Bottom line */}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
