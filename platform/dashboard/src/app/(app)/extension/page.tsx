'use client';

export default function ExtensionPage() {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Browser Extension</h1>
        <p className="page-sub">Bridge any site you&apos;re visiting in one click</p>
      </div>

      <div className="install-card">
        <div className="install-icon">🧩</div>
        <div className="install-title">AgentBridge Extension</div>
        <div className="install-desc">
          While browsing any website, click the extension icon to instantly bridge it to your AI agent — no terminal, no JSON editing.
        </div>

        <div className="steps-list">
          {[
            'Install the extension from the Chrome Web Store',
            'Browse to any website (Gmail, Notion, GitHub…)',
            'Click the ⚡ AgentBridge icon in your toolbar',
            'Click "Bridge This Site" — done in under 30 seconds',
          ].map((s, i) => (
            <div key={i} className="steps-list-item">
              <div className="step-bullet">{i + 1}</div>
              <div className="step-text">{s}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <a
            href="https://chrome.google.com/webstore"
            target="_blank"
            className="btn btn-primary btn-full btn-lg"
            rel="noreferrer"
          >
            🌐 Install for Chrome / Edge
          </a>
          <a
            href="/extension/agentbridge-extension.zip"
            className="btn btn-secondary btn-full"
          >
            📦 Download .zip (manual install)
          </a>
        </div>

        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--bg-elevated)', borderRadius: 10, fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'left' }}>
          <strong style={{ color: 'var(--text-secondary)' }}>Privacy:</strong> The extension only reads the current tab URL when you click the icon. No background tracking, no data collection.
        </div>
      </div>
    </>
  );
}
