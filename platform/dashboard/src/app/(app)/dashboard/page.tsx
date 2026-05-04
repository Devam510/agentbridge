'use client';
import { useEffect, useState } from 'react';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch_ = () =>
      fetch('/api/usage')
        .then(r => r.json())
        .then(d => { setData(d); setLoading(false); })
        .catch(() => setLoading(false));
    fetch_();
    const id = setInterval(fetch_, 3000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading dashboard…</div>
      </div>
    );
  }

  const {
    totalActions = 0, successfulActions = 0, failedActions = 0,
    avgLatencyMs = 0, uniqueAgents = 0, apiCalls = 0, browserCalls = 0,
    topCapabilities = [], recentEvents = [],
  } = data || {};
  const successRate = totalActions > 0 ? Math.round((successfulActions / totalActions) * 100) : 0;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <p className="page-sub">Live usage data — updates every 3 seconds</p>
      </div>

      {/* Stats */}
      <div className="grid-4">
        <div className="card">
          <div className="card-label">Total Actions (7d)</div>
          <div className="card-value">{totalActions.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="card-label">Success Rate</div>
          <div className={`card-value ${successRate >= 90 ? 'success' : 'error'}`}>{successRate}%</div>
        </div>
        <div className="card">
          <div className="card-label">Avg Latency</div>
          <div className="card-value">{avgLatencyMs}ms</div>
        </div>
        <div className="card">
          <div className="card-label">Active Agents</div>
          <div className="card-value">{uniqueAgents}</div>
        </div>
      </div>

      {/* Secondary stats */}
      <div className="grid-4" style={{ marginBottom: '2rem' }}>
        <div className="card">
          <div className="card-label">Successful</div>
          <div className="card-value success">{successfulActions}</div>
        </div>
        <div className="card">
          <div className="card-label">Failed</div>
          <div className="card-value error">{failedActions}</div>
        </div>
        <div className="card">
          <div className="card-label">API Calls</div>
          <div className="card-value">{apiCalls}</div>
        </div>
        <div className="card">
          <div className="card-label">Browser Calls</div>
          <div className="card-value">{browserCalls}</div>
        </div>
      </div>

      {/* Panels */}
      <div className="grid-2">
        <div className="card">
          <div className="card-title">Top Capabilities</div>
          {topCapabilities.length === 0
            ? <div className="empty-state">No capability data yet.<br/>Use a bridge with Claude to see activity here.</div>
            : topCapabilities.map((cap: any, i: number) => (
              <div key={i} className="event-row">
                <div>
                  <div className="event-name">{cap.capabilityId}</div>
                </div>
                <span className="badge badge-api">{cap.count} calls</span>
              </div>
            ))}
        </div>

        <div className="card">
          <div className="card-title">Recent Events</div>
          {recentEvents.length === 0
            ? <div className="empty-state">No events yet.<br/>Connect a bridge and let your AI agent start using it.</div>
            : recentEvents.slice(0, 10).map((evt: any, i: number) => (
              <div key={i} className="event-row">
                <div>
                  <div className="event-name">{evt.capabilityId}</div>
                  <div className="event-meta">{evt.agentId} • {evt.latencyMs}ms</div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span className={`badge ${evt.success ? 'badge-success' : 'badge-error'}`}>
                    {evt.success ? 'OK' : 'Fail'}
                  </span>
                  <span className={`badge ${evt.executionPath === 'api' ? 'badge-api' : 'badge-browser'}`}>
                    {evt.executionPath}
                  </span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
