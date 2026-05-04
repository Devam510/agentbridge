'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: '📊' },
  { href: '/create', label: 'New Bridge', icon: '➕' },
  { href: '/marketplace', label: 'Marketplace', icon: '🏪' },
  { href: '/extension', label: 'Extension', icon: '🧩' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">⚡ AgentBridge</div>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`sidebar-link ${path === n.href ? 'active' : ''}`}
          >
            <span>{n.icon}</span> {n.label}
          </Link>
        ))}
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
