"use client";

import { ThemeProvider as TP } from "next-themes";

export function ThemeProvider(props: React.ComponentProps<typeof TP>) {
  return <TP {...props} />;
}

export { useTheme } from "next-themes";