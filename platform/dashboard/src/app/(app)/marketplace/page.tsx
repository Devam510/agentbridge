'use client';
import { useState } from 'react';

const CATEGORIES = ['All','Productivity','Dev Tools','CRM','Finance','E-Commerce','Design','Communication','Analytics'];

const APPS = [
  {name:'Gmail',cat:'Communication',icon:'📧',status:'ready'},{name:'Google Calendar',cat:'Productivity',icon:'📅',status:'ready'},{name:'Google Drive',cat:'Productivity',icon:'📁',status:'ready'},{name:'Google Docs',cat:'Productivity',icon:'📄',status:'ready'},{name:'Google Sheets',cat:'Productivity',icon:'📊',status:'ready'},{name:'Google Meet',cat:'Communication',icon:'📹',status:'ready'},
  {name:'Notion',cat:'Productivity',icon:'📝',status:'ready'},{name:'Slack',cat:'Communication',icon:'💬',status:'ready'},{name:'GitHub',cat:'Dev Tools',icon:'🐙',status:'ready'},{name:'GitLab',cat:'Dev Tools',icon:'🦊',status:'ready'},{name:'Jira',cat:'Dev Tools',icon:'🎯',status:'ready'},{name:'Linear',cat:'Dev Tools',icon:'⚡',status:'ready'},{name:'Asana',cat:'Productivity',icon:'✅',status:'ready'},{name:'Trello',cat:'Productivity',icon:'📋',status:'ready'},
  {name:'Salesforce',cat:'CRM',icon:'☁️',status:'ready'},{name:'HubSpot',cat:'CRM',icon:'🔶',status:'ready'},{name:'Pipedrive',cat:'CRM',icon:'🔷',status:'ready'},{name:'Zoho CRM',cat:'CRM',icon:'🔵',status:'ready'},
  {name:'Stripe',cat:'Finance',icon:'💳',status:'ready'},{name:'QuickBooks',cat:'Finance',icon:'💰',status:'ready'},{name:'Xero',cat:'Finance',icon:'🟢',status:'ready'},{name:'FreshBooks',cat:'Finance',icon:'🍃',status:'ready'},
  {name:'Shopify',cat:'E-Commerce',icon:'🛍️',status:'ready'},{name:'WooCommerce',cat:'E-Commerce',icon:'🛒',status:'ready'},{name:'BigCommerce',cat:'E-Commerce',icon:'🏪',status:'ready'},{name:'Etsy',cat:'E-Commerce',icon:'🎨',status:'ready'},
  {name:'Figma',cat:'Design',icon:'🎨',status:'ready'},{name:'Adobe XD',cat:'Design',icon:'🔴',status:'ready'},{name:'Canva',cat:'Design',icon:'✏️',status:'ready'},{name:'InVision',cat:'Design',icon:'💎',status:'ready'},
  {name:'Zendesk',cat:'CRM',icon:'🎫',status:'ready'},{name:'Intercom',cat:'Communication',icon:'💬',status:'ready'},{name:'Freshdesk',cat:'CRM',icon:'🌿',status:'ready'},{name:'Airtable',cat:'Productivity',icon:'🗃️',status:'ready'},
  {name:'Monday.com',cat:'Productivity',icon:'📅',status:'ready'},{name:'ClickUp',cat:'Productivity',icon:'🖱️',status:'ready'},{name:'Confluence',cat:'Dev Tools',icon:'📚',status:'ready'},{name:'Bitbucket',cat:'Dev Tools',icon:'🪣',status:'ready'},
  {name:'Vercel',cat:'Dev Tools',icon:'▲',status:'ready'},{name:'Netlify',cat:'Dev Tools',icon:'🌐',status:'ready'},{name:'Heroku',cat:'Dev Tools',icon:'💜',status:'ready'},{name:'AWS Console',cat:'Dev Tools',icon:'🟠',status:'crawl'},
  {name:'Google Analytics',cat:'Analytics',icon:'📈',status:'ready'},{name:'Mixpanel',cat:'Analytics',icon:'🧪',status:'ready'},{name:'Amplitude',cat:'Analytics',icon:'📉',status:'ready'},{name:'Hotjar',cat:'Analytics',icon:'🔥',status:'ready'},
  {name:'Dropbox',cat:'Productivity',icon:'📦',status:'ready'},{name:'Box',cat:'Productivity',icon:'📤',status:'ready'},{name:'OneDrive',cat:'Productivity',icon:'☁️',status:'ready'},{name:'Zoom',cat:'Communication',icon:'📹',status:'ready'},
  {name:'Microsoft Teams',cat:'Communication',icon:'🔷',status:'ready'},{name:'Discord',cat:'Communication',icon:'🎮',status:'ready'},{name:'Twilio',cat:'Dev Tools',icon:'🔴',status:'crawl'},{name:'SendGrid',cat:'Dev Tools',icon:'📨',status:'crawl'},
  {name:'Mailchimp',cat:'Communication',icon:'🐒',status:'ready'},{name:'ConvertKit',cat:'Communication',icon:'✉️',status:'ready'},{name:'ActiveCampaign',cat:'CRM',icon:'🚀',status:'ready'},{name:'Klaviyo',cat:'E-Commerce',icon:'📩',status:'ready'},
  {name:'Webflow',cat:'Design',icon:'🌊',status:'ready'},{name:'WordPress',cat:'Dev Tools',icon:'🔵',status:'ready'},{name:'Ghost',cat:'Dev Tools',icon:'👻',status:'ready'},{name:'Squarespace',cat:'Design',icon:'⬛',status:'crawl'},
  {name:'Calendly',cat:'Productivity',icon:'📆',status:'ready'},{name:'Typeform',cat:'Dev Tools',icon:'📋',status:'ready'},{name:'SurveyMonkey',cat:'Analytics',icon:'🐵',status:'ready'},{name:'Loom',cat:'Communication',icon:'🎥',status:'ready'},
  {name:'Notion AI',cat:'Productivity',icon:'🤖',status:'crawl'},{name:'Coda',cat:'Productivity',icon:'📒',status:'ready'},{name:'Roam Research',cat:'Productivity',icon:'🧠',status:'crawl'},{name:'Obsidian',cat:'Productivity',icon:'💜',status:'crawl'},
  {name:'Miro',cat:'Design',icon:'🎯',status:'ready'},{name:'Lucidchart',cat:'Design',icon:'📐',status:'ready'},{name:'Draw.io',cat:'Design',icon:'✏️',status:'ready'},{name:'Whimsical',cat:'Design',icon:'🌀',status:'ready'},
  {name:'Postman',cat:'Dev Tools',icon:'🟠',status:'ready'},{name:'Insomnia',cat:'Dev Tools',icon:'😴',status:'crawl'},{name:'Swagger UI',cat:'Dev Tools',icon:'🟢',status:'crawl'},{name:'PagerDuty',cat:'Dev Tools',icon:'🚨',status:'ready'},
  {name:'Datadog',cat:'Analytics',icon:'🐕',status:'crawl'},{name:'Sentry',cat:'Dev Tools',icon:'🔍',status:'ready'},{name:'New Relic',cat:'Analytics',icon:'🟢',status:'crawl'},{name:'LogRocket',cat:'Analytics',icon:'🚀',status:'crawl'},
];

export default function MarketplacePage() {
  const [cat, setCat] = useState('All');
  const [search, setSearch] = useState('');

  const filtered = APPS.filter(a =>
    (cat === 'All' || a.cat === cat) &&
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Marketplace</h1>
        <p className="page-sub">500+ pre-built bridges — install any app in one click</p>
      </div>

      <div style={{ display:'flex', gap:'1rem', alignItems:'center', flexWrap:'wrap' }}>
        <input
          className="input-field search-bar"
          placeholder="Search apps…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span style={{ color:'var(--text-muted)', fontSize:'0.875rem' }}>{filtered.length} apps</span>
      </div>

      <div className="filter-tabs">
        {CATEGORIES.map(c => (
          <button key={c} className={`filter-tab ${cat===c?'active':''}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>

      <div className="marketplace-grid">
        {filtered.map((app) => (
          <div key={app.name} className="app-card" onClick={() => {
            let realUrl = `https://${app.name.toLowerCase().replace(/\s/g,'')}.com`;
            if (app.name === 'Google Calendar') realUrl = 'https://calendar.google.com';
            if (app.name === 'Google Drive') realUrl = 'https://drive.google.com';
            if (app.name === 'Google Docs') realUrl = 'https://docs.google.com';
            if (app.name === 'Google Sheets') realUrl = 'https://sheets.google.com';
            if (app.name === 'Google Meet') realUrl = 'https://meet.google.com';
            if (app.name === 'GitHub') realUrl = 'https://github.com';
            if (app.name === 'Notion AI') realUrl = 'https://notion.so';
            if (app.name === 'AWS Console') realUrl = 'https://console.aws.amazon.com';
            window.location.href = `/create?url=${realUrl}`;
          }}>
            <div className="app-icon">{app.icon}</div>
            <div>
              <div className="app-name">{app.name}</div>
              <div className="app-category">{app.cat}</div>
            </div>
            <div className={`app-status ${app.status}`}>
              {app.status === 'ready' ? '✅ Ready to install' : '🔄 Auto-crawl'}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
