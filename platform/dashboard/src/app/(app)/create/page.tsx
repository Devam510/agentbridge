'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const STEPS = [
  'Launching browser…',
  'Crawling pages and links…',
  'Detecting forms and inputs…',
  'Mapping actions and buttons…',
  'Identifying API endpoints…',
  'Generating MCP server…',
  'Deploying to cloud…',
  'Bridge ready! ✅',
];

function CreatePageInner() {
  const params = useSearchParams();
  const [url, setUrl] = useState(params.get('url') || '');
  const [bridgeName, setBridgeName] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);

  const addLog = (msg: string) => setLogs(prev => [...prev, `> ${msg}`]);

  const simulate = async () => {
    if (!url) return;
    const name = bridgeName || url.replace(/https?:\/\//,'').split('/')[0].replace(/\./g,'-');
    setStatus('running');
    setLogs([]);
    setProgress(0);
    setResult(null);

    for (let i = 0; i < STEPS.length; i++) {
      await new Promise(r => setTimeout(r, 700 + Math.random() * 400));
      addLog(STEPS[i]);
      setProgress(Math.round(((i + 1) / STEPS.length) * 100));
    }

    setResult({
      bridgeName: name,
      endpoint: `https://mcp.agentbridge.io/b/${name}`,
      capabilities: Math.floor(3 + Math.random() * 12),
      claudeConfig: JSON.stringify({
        mcpServers: {
          [name]: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/client-sse', '--url', `https://mcp.agentbridge.io/b/${name}/sse`],
          }
        }
      }, null, 2),
    });
    setStatus('done');
  };

  const autoInstall = async () => {
    if (!url) return;
    try {
      const res = await fetch('http://localhost:3001/api/bridge/generate-and-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Installed!');
      } else {
        alert('Error: ' + data.error);
      }
    } catch (e) {
      alert('Could not connect to Companion App. Please download and run the installer first!');
    }
  };

  return (
    <div className="create-wrap">
      <div className="page-header">
        <h1 className="page-title">New Bridge</h1>
        <p className="page-sub">Paste any URL to automatically generate an MCP server for it</p>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="input-group">
          <label className="input-label">Website URL</label>
          <input
            id="bridge-url"
            className="input-field"
            placeholder="https://notion.com"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={status === 'running'}
          />
        </div>
        <div className="input-group">
          <label className="input-label">Bridge Name (optional)</label>
          <input
            id="bridge-name"
            className="input-field"
            placeholder="my-notion-bridge"
            value={bridgeName}
            onChange={e => setBridgeName(e.target.value)}
            disabled={status === 'running'}
          />
        </div>
        <button
          id="bridge-start-btn"
          className="btn btn-primary btn-full btn-lg"
          onClick={simulate}
          disabled={status === 'running' || !url}
          style={{ opacity: !url ? 0.5 : 1 }}
        >
          {status === 'running' ? '⏳ Generating bridge…' : '⚡ Generate Bridge'}
        </button>
      </div>

      {/* Progress */}
      {status !== 'idle' && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Progress</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{progress}%</span>
          </div>
          <div className="progress-bar-wrap">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <div className="log-box" id="bridge-log">
            {logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {/* Result */}
      {status === 'done' && result && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div className="card-title" style={{ margin: 0 }}>✅ Bridge Ready</div>
            <span className="badge badge-success">{result.capabilities} capabilities found</span>
          </div>

          {/* PRIMARY: Auto Install */}
          <div style={{ background: '#020407', border: '1px solid var(--border-glow)', borderRadius: 12, padding: '1.25rem', marginBottom: '1.25rem' }}>
            <div className="input-label" style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>
              🚀 Bridge successfully built and deployed!
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                className="btn btn-primary btn-lg"
                style={{ flex: 1, padding: '1rem', fontSize: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                onClick={autoInstall}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                Connect to Claude, Cursor & Windsurf Automatically
              </button>
            </div>
            <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              Requires the AgentBridge Companion App to be running in the background.
            </div>
          </div>

          {/* SECONDARY: Advanced / manual */}
          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Show advanced options (manual JSON config)
            </summary>
            <div style={{ marginBottom: '0.75rem' }}>
              <div className="input-label">Cloud Endpoint</div>
              <div className="input-field" style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--accent)' }}>
                {result.endpoint}
              </div>
            </div>
            <pre style={{
              background: '#020407', border: '1px solid var(--border)', borderRadius: 10,
              padding: '1rem', fontSize: '0.78rem', color: '#7dd3fc',
              overflow: 'auto', fontFamily: 'monospace', lineHeight: 1.6, marginBottom: '0.75rem'
            }}>
              {result.claudeConfig}
            </pre>
            <button className="btn btn-secondary btn-full"
              onClick={() => navigator.clipboard.writeText(result.claudeConfig)}>
              📋 Copy Raw JSON Config
            </button>
          </details>
        </div>
      )}
    </div>
  );
}

export default function CreatePage() {
  return (
    <Suspense>
      <CreatePageInner />
    </Suspense>
  );
}
