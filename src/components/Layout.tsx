import type { ReactNode, ComponentType } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Eye, Building2, Package, FileText, BarChart3, Settings, LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRole } from '@/lib/roles';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/fiches', icon: Building2, label: 'Concurrents' },
  { to: '/produits', icon: Package, label: 'Produits' },
  { to: '/notes', icon: FileText, label: 'Notes' },
  { to: '/pivot', icon: BarChart3, label: 'Tableau pivot' },
  { to: '/admin', icon: Settings, label: 'Administration', adminOnly: true },
];

export function Layout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { role, isAdmin } = useRole();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const visibleNav = NAV.filter(n => !n.adminOnly || isAdmin);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-60 border-r bg-card shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 h-16 border-b">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Eye className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">Veille</p>
            <p className="text-xs text-muted-foreground leading-tight">Intelligence concurrentielle</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {visibleNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn('flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t space-y-1">
          {role && (
            <p className="text-xs text-muted-foreground px-3 pb-1 capitalize">
              Rôle : <span className="font-medium text-foreground">{role}</span>
            </p>
          )}
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            Déconnexion
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-card border-b flex items-center px-4 gap-3">
        <button onClick={() => setMobileOpen(v => !v)} className="p-1 rounded-md hover:bg-accent">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Veille</span>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black/40" onClick={() => setMobileOpen(false)}>
          <aside className="w-64 h-full bg-card border-r pt-14 flex flex-col" onClick={e => e.stopPropagation()}>
            <nav className="flex-1 p-3 space-y-1">
              {visibleNav.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn('flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="p-3 border-t">
              <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={handleSignOut}>
                <LogOut className="h-4 w-4" />
                Déconnexion
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-screen pt-14 md:pt-0 overflow-auto">
        <div className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
