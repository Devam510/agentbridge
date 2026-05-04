'use client';
import Link from 'next/link';

const APPS = [
  'Gmail','Notion','GitHub','Slack','Jira','Salesforce','Shopify','QuickBooks',
  'Figma','Airtable','Zendesk','HubSpot','Stripe','Trello','Asana','Linear',
];

export default function LandingPage() {
  return (
    <>
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-logo">⚡ AgentBridge</div>
        <div className="navbar-links">
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/create" className="btn btn-primary">Get Started →</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-badge">🚀 Now in beta — free forever</div>
        <h1 className="hero-title">
          Connect <span>any website</span> to your AI agent in 30 seconds
        </h1>
        <p className="hero-sub">
          No API keys. No code. No terminal. Paste a URL and AgentBridge auto-generates
          an MCP server that works with Claude, Cursor, and any AI agent.
        </p>
        <div className="hero-input-wrap">
          <input
            className="hero-input"
            placeholder="Paste any URL — notion.com, github.com, gmail.com..."
            id="hero-url-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const val = (e.target as HTMLInputElement).value;
                if (val) window.location.href = `/create?url=${encodeURIComponent(val)}`;
              }
            }}
          />
          <button
            className="btn btn-primary"
            onClick={() => {
              const el = document.getElementById('hero-url-input') as HTMLInputElement;
              if (el?.value) window.location.href = `/create?url=${encodeURIComponent(el.value)}`;
            }}
          >
            Bridge It →
          </button>
        </div>
      </section>

      {/* Marquee — supported apps */}
      <div className="marquee-wrap">
        <div className="marquee-track">
          {[...APPS, ...APPS].map((app, i) => (
            <div key={i} className="marquee-item">
              <span>✦</span> {app}
            </div>
          ))}
        </div>
      </div>

      {/* How it Works */}
      <div className="section">
        <div className="section-label">How it works</div>
        <h2 className="section-title">Three steps. Zero headaches.</h2>
        <p className="section-sub">
          AgentBridge handles all the complexity so your AI agent can immediately start using any website.
        </p>
        <div className="steps-grid">
          {[
            { n: '01', title: 'Paste a URL', desc: 'Enter any website URL. AgentBridge crawls it to discover all capabilities — forms, buttons, searches, APIs.' },
            { n: '02', title: 'We generate the bridge', desc: 'A spec-compliant MCP server is automatically generated and deployed to the cloud in seconds.' },
            { n: '03', title: 'Click Connect', desc: 'One click installs the bridge into Claude Desktop, Cursor, or any MCP-compatible AI agent. Done.' },
          ].map((s) => (
            <div key={s.n} className="step-card">
              <div className="step-num">{s.n}</div>
              <div className="step-title">{s.title}</div>
              <div className="step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ textAlign: 'center', padding: '4rem 2rem', borderTop: '1px solid var(--border)' }}>
        <h2 className="section-title" style={{ marginBottom: '1rem' }}>Ready to supercharge your AI agent?</h2>
        <p className="section-sub" style={{ margin: '0 auto 2rem' }}>
          Download the One-Click Installer. No terminal, no JSON editing, connects instantly to Claude Desktop, Cursor, and Windsurf.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', alignItems: 'center' }}>
          <a href="/installers/install.bat" download className="btn btn-primary btn-lg" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" fill="currentColor"/></svg>
            Download for Windows
          </a>
          <a href="/installers/install.sh" download className="btn btn-secondary btn-lg" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="20" height="20" viewBox="0 0 384 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 24 184.8 8 273.5q-9 50.6 17.7 125.2c15.4 37.7 35.7 75.6 69 74.6 32.1-1 43.4-21.1 82-21.1 38.5 0 48.7 20.7 82.4 20.7 32.6 0 49.8-31 66-67.2 20.9-47.4 34-83.6 34.3-85.3-2.6-1.5-40.4-16.7-40.7-51.7zM211.4 92.5c21.5-26.5 35.9-63.1 31.9-92.5-24.5 1-54.8 16.3-76.4 43.5-17.6 22-34.1 60.1-29.3 88.6 27.2 2.1 53-14 73.8-39.6z"/></svg>
            Download for Mac
          </a>
        </div>
      </div>
    </>
  );
}
