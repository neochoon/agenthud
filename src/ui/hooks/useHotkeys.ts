import { useCallback, useMemo } from "react";

interface ManualPanel {
  name: string;
  label: string;
  action: () => void;
}

interface Hotkey {
  key: string;
  label: string;
  action: () => void;
}

interface UseHotkeysOptions {
  manualPanels: ManualPanel[];
  onRefreshAll: () => void;
  onQuit: () => void;
}

interface UseHotkeysResult {
  hotkeys: Hotkey[];
  handleInput: (key: string) => void;
  statusBarItems: string[];
}

// Reserved keys that cannot be used by panels
const RESERVED_KEYS = new Set(["r", "q"]);

export function useHotkeys({
  manualPanels,
  onRefreshAll,
  onQuit,
}: UseHotkeysOptions): UseHotkeysResult {
  // Generate hotkeys for manual panels
  const hotkeys = useMemo(() => {
    const result: Hotkey[] = [];
    const usedKeys = new Set<string>(RESERVED_KEYS);

    // Generate hotkeys for manual panels
    for (const panel of manualPanels) {
      let assignedKey: string | null = null;

      // Find first available character from panel name
      for (const char of panel.name.toLowerCase()) {
        if (!usedKeys.has(char)) {
          assignedKey = char;
          usedKeys.add(char);
          break;
        }
      }

      // Only add hotkey if we found an available key
      if (assignedKey) {
        result.push({
          key: assignedKey,
          label: panel.label,
          action: panel.action,
        });
      }
    }

    // Add refresh all hotkey
    result.push({
      key: "r",
      label: "refresh all",
      action: onRefreshAll,
    });

    // Add quit hotkey
    result.push({
      key: "q",
      label: "quit",
      action: onQuit,
    });

    return result;
  }, [manualPanels, onRefreshAll, onQuit]);

  // Handle keyboard input
  const handleInput = useCallback(
    (key: string) => {
      const hotkey = hotkeys.find((h) => h.key === key);
      if (hotkey) {
        hotkey.action();
      }
    },
    [hotkeys],
  );

  // Generate status bar items
  const statusBarItems = useMemo(() => {
    return hotkeys.map((h) => `${h.key}: ${h.label}`);
  }, [hotkeys]);

  return {
    hotkeys,
    handleInput,
    statusBarItems,
  };
}
