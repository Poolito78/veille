import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useConcurrents } from './concurrents';

type ConcurrentsContextValue = ReturnType<typeof useConcurrents>;

const ConcurrentsContext = createContext<ConcurrentsContextValue | null>(null);

export function ConcurrentsProvider({ children }: { children: ReactNode }) {
  const value = useConcurrents();
  return <ConcurrentsContext.Provider value={value}>{children}</ConcurrentsContext.Provider>;
}

export function useConcurrentsCtx(): ConcurrentsContextValue {
  const ctx = useContext(ConcurrentsContext);
  if (!ctx) throw new Error('useConcurrentsCtx must be used inside ConcurrentsProvider');
  return ctx;
}
