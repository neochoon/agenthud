import { Text } from "ink";
import type React from "react";

/** One-line search prompt shown in the status area: `/query   3/12`.
 * `total` 0 renders `0/0`; `current` is 1-based for display. */
export function SearchInput(props: {
  query: string;
  current: number; // 1-based; 0 when no matches
  total: number;
}): React.ReactElement {
  const count = props.total === 0 ? "0/0" : `${props.current}/${props.total}`;
  return (
    <Text>
      <Text color="cyan">/</Text>
      {props.query}
      <Text dimColor>{`   ${count}`}</Text>
    </Text>
  );
}
