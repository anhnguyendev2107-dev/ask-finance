"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface DrawerContextValue {
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  closeAll: () => void;
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const value = useMemo<DrawerContextValue>(
    () => ({
      leftOpen,
      rightOpen,
      setLeftOpen,
      setRightOpen,
      closeAll: () => {
        setLeftOpen(false);
        setRightOpen(false);
      },
    }),
    [leftOpen, rightOpen],
  );

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function useDrawer(): DrawerContextValue {
  const ctx = useContext(DrawerContext);
  if (!ctx) {
    // Safe fallback for any consumer rendered outside the provider (e.g. docs
    // pages that don't have drawers). Returns no-op setters and false flags.
    return {
      leftOpen: false,
      rightOpen: false,
      setLeftOpen: () => undefined,
      setRightOpen: () => undefined,
      closeAll: () => undefined,
    };
  }
  return ctx;
}
