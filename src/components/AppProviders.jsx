import React from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';

export function AppProviders({ children }) {
  return (
    <ThemeProvider>
      {children}
    </ThemeProvider>
  );
}