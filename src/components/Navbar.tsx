import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import type { AppTab, User } from '../types';

interface NavbarProps {
  activeTab: AppTab;
  onNavigate: (tab: AppTab, subSection?: string) => void;
  user: User | null;
  unreadNotifications: number;
  onOpenAuth: () => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'food-rescue', label: 'Food Rescue' },
  { id: 'ai-lab', label: 'AI Assistant' },
  { id: 'impact', label: 'Impact' },
];

export function Navbar({
  activeTab,
  onNavigate,
  user,
  unreadNotifications,
  onOpenAuth,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (tab: AppTab) => {
    onNavigate(tab);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#A9B78D]/15 bg-[#0A110E]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single clean wordmark */}
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="font-display text-xl font-semibold tracking-tight text-[#F4F7F4] whitespace-nowrap shrink-0 focus-ring rounded-sm cursor-pointer"
        >
          VERDORA
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav aria-label="Primary navigation" className="hidden lg:flex items-center gap-7">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-ring ${
                  active ? 'text-[#93C9A3]' : 'text-[#C8D6CD] hover:text-[#F4F7F4]'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[1px] h-[2px] bg-[#93C9A3]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action / account trigger */}
        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => handleNav('workspace')}
              className="hidden sm:inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#348F68] whitespace-nowrap shrink-0 cursor-pointer focus-ring"
            >
              {user.avatarUrl && (
                <img
                  src={user.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                  className="h-4 w-4 rounded-full object-cover"
                />
              )}
              <span>{user.name.split(' ')[0]}</span>
              {unreadNotifications > 0 && (
                <span className="font-mono-tabular text-[11px] opacity-90">({unreadNotifications})</span>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="hidden sm:inline-flex items-center rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#348F68] whitespace-nowrap shrink-0 cursor-pointer focus-ring"
            >
              Sign In
            </button>
          )}

          <button
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#A9B78D]/25 text-[#F4F7F4] hover:bg-[#172620] lg:hidden cursor-pointer focus-ring"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-[#A9B78D]/15 bg-[#0E1813] px-4 py-4 lg:hidden">
          <div className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium cursor-pointer ${
                    active
                      ? 'bg-[#2B7A58]/25 text-[#93C9A3]'
                      : 'text-[#D2DDD6] hover:bg-[#172620] hover:text-[#F4F7F4]'
                  }`}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
            <div className="mt-3 border-t border-[#A9B78D]/15 pt-3">
              {user ? (
                <button
                  type="button"
                  onClick={() => handleNav('workspace')}
                  className="w-full rounded-lg bg-[#2B7A58] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                >
                  Open Workspace ({user.name.split(' ')[0]})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    onOpenAuth();
                  }}
                  className="w-full rounded-lg bg-[#2B7A58] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                >
                  Continue with Google
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
