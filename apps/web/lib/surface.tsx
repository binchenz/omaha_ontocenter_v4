'use client';

import { createContext, useContext, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { surfacesFor, SURFACE, type Surface } from '@omaha/shared-types';
import { useAuth } from './auth';

/**
 * Surface scaffolding (ADR-0041). Surface is a first-class concept: the current surface
 * is derived from the route, and the set of surfaces a user may see is derived from their
 * permissions via the shared `surfacesFor` (the same function the back end's skill
 * assembly and guard use, so the nav can never show what the gate would deny).
 *
 * This is the shallow UX layer of the boundary, never the gate.
 */

/** Which surface each built route belongs to. Unbuilt surfaces (create/pipeline) have no
 * routes yet, so they never appear in the nav even when a Role authorizes them. */
export const ROUTE_SURFACE: Array<{ href: string; label: string; icon: string; surface: Surface }> = [
  { href: '/chat', label: 'AI 对话', icon: '◉', surface: SURFACE.CONSUME },
  { href: '/query', label: '数据查询', icon: '⊞', surface: SURFACE.CONSUME },
  { href: '/ontology', label: '本体浏览', icon: '◈', surface: SURFACE.MAINTAIN },
];

interface SurfaceContextType {
  /** The surface the current route belongs to (consume by default). */
  currentSurface: Surface;
  /** The surfaces this user's permissions authorize. */
  authorizedSurfaces: Surface[];
}

const SurfaceContext = createContext<SurfaceContextType | null>(null);

export function SurfaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();

  const matched = ROUTE_SURFACE.find((r) => pathname.startsWith(r.href));
  const currentSurface = matched?.surface ?? SURFACE.CONSUME;
  const authorizedSurfaces = surfacesFor(user?.permissions ?? []);

  return (
    <SurfaceContext.Provider value={{ currentSurface, authorizedSurfaces }}>
      {children}
    </SurfaceContext.Provider>
  );
}

export function useSurface() {
  const ctx = useContext(SurfaceContext);
  if (!ctx) throw new Error('useSurface must be used within SurfaceProvider');
  return ctx;
}
