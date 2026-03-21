import React, { useEffect, useMemo, useState } from 'react';

const RENTCAST_KEY = 'cb15a8f37df94aab92c5107fd0a5f395';

const SUPABASE_URL = 'https://iuuhvostbnybioegwmvl.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1dWh2b3N0Ym55YmlvZWd3bXZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NzM0MjgsImV4cCI6MjA4OTI0OTQyOH0.KG0HBqHza2eVaLWgw2uIoAEeTLlqDbyIM7Sm-OM4htk';

// ---------------------------------------------------------------------------
// SUPABASE HELPERS
// ---------------------------------------------------------------------------
async function sbSelect(table, cols, filters, single = false) {
  const params = new URLSearchParams({ select: cols });
  if (filters)
    Object.entries(filters).forEach(([k, v]) => params.set(k, 'eq.' + v));
  if (single) params.set('limit', '1');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
    },
  });
  const d = await r.json();
  if (!r.ok) return { data: null, error: d };
  return {
    data: single ? (Array.isArray(d) && d.length > 0 ? d[0] : null) : d,
    error: null,
  };
}

async function sbInsert(table, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const d = await r.json();
  return {
    data: r.ok ? (Array.isArray(d) ? d[0] : d) : null,
    error: r.ok ? null : d,
  };
}

async function sbUpdate(table, row, col, val) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${encodeURIComponent(val)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(row),
    }
  );
  return { error: r.ok ? null : await r.json() };
}

async function sbSelectOrdered(table, cols, filterCol, filterVal, orderCol, ascending, limit) {
  const dir = ascending ? 'asc' : 'desc';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=${cols}&${filterCol}=eq.${encodeURIComponent(
      filterVal
    )}&order=${orderCol}.${dir}&limit=${limit}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      },
    }
  );
  const d = await r.json();
  return { data: r.ok ? d : null, error: r.ok ? null : d };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function fmt$(v) {
  if (!v && v !== 0) return 'N/A';
  return '$' + Number(v).toLocaleString();
}

function fmtNum(v) {
  if (!v && v !== 0) return 'N/A';
  return Number(v).toLocaleString();
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function zillowUrl(comp) {
  const parts = [
    comp.addressLine1 || '',
    comp.city || '',
    comp.state || '',
    comp.zipCode || '',
  ].filter(Boolean);
  const slug = parts
    .join('-')
    .replace(/[^a-zA-Z0-9\-]/g, '-')
    .replace(/-+/g, '-');
  return `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`;
}

function typeCompatible(a, b) {
  const t = ['condo', 'condominium', 'townhouse', 'townhome'];
  const aL = (a || '').toLowerCase();
  const bL = (b || '').toLowerCase();
  return (
    (t.some((x) => aL.includes(x)) && t.some((x) => bL.includes(x))) ||
    aL === bL
  );
}

async function hashPassword(pw) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(pw)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function buildAddress(prop) {
  return [prop.addressLine1, prop.city, prop.state, prop.zipCode]
    .filter(Boolean)
    .join(', ');
}

// ---------------------------------------------------------------------------
// SCORING
// ---------------------------------------------------------------------------
function scoreComp(subject, comp, distMiles, maxRadius) {
  let d = 0;
  if ((comp.bedrooms || 0) !== (subject.bedrooms || 0)) return null;
  const sp = subject._displayPrice;
  const cp = comp.price || comp.listPrice;
  if (sp && cp) d += Math.min(30, (Math.abs(cp - sp) / sp) * 60);
  else d += 15;

  if (subject.squareFootage && comp.squareFootage)
    d += Math.min(
      20,
      (Math.abs(comp.squareFootage - subject.squareFootage) /
        subject.squareFootage) *
        40
    );
  else d += 10;

  d += Math.min(distMiles / maxRadius, 1) * 10;
  return Math.max(0, Math.round(100 - d));
}

function scoreLabel(score) {
  if (score >= 85) return { label: 'Very Strong', color: '#22c55e' };
  if (score >= 70) return { label: 'Strong', color: '#84cc16' };
  if (score >= 55) return { label: 'Good', color: '#eab308' };
  if (score >= 40) return { label: 'Fair', color: '#f97316' };
  return { label: 'Loose', color: '#ef4444' };
}

function keyDiffs(subject, comp) {
  const diffs = [];
  const sp = subject._displayPrice;
  const cp = comp.price || comp.listPrice;
  if (sp && cp) {
    const diff = cp - sp;
    const pct = ((diff / sp) * 100).toFixed(0);
    diffs.push(
      Math.abs(Number(pct)) < 3
        ? 'Similar price'
        : `${diff > 0 ? '+' : ''}${fmt$(diff)} (${pct}%)`
    );
  }
  if (subject.squareFootage && comp.squareFootage) {
    const diff = comp.squareFootage - subject.squareFootage;
    const pct = ((Math.abs(diff) / subject.squareFootage) * 100).toFixed(0);
    diffs.push(
      Math.abs(Number(pct)) < 4
        ? 'Similar size'
        : `${diff > 0 ? '+' : ''}${fmtNum(diff)} sqft (${pct}% ${
            diff > 0 ? 'larger' : 'smaller'
          })`
    );
  }
  return diffs.slice(0, 2);
}

function talkingPoints(subject, comp) {
  const pts = [];
  const bedDiff = Math.abs((comp.bedrooms || 0) - (subject.bedrooms || 0));
  if (bedDiff === 0) pts.push(`Same bedroom count (${comp.bedrooms} bed)`);
  else pts.push(`${comp.bedrooms} bed vs ${subject.bedrooms} bed`);

  const sp = subject._displayPrice;
  const cp = comp.price || comp.listPrice;
  if (sp && cp) {
    const diff = cp - sp;
    const pct = ((diff / sp) * 100).toFixed(1);
    pts.push(
      Math.abs(diff) < 10000
        ? 'Nearly identical price'
        : `${diff > 0 ? '+' : ''}${fmt$(diff)} (${pct}%)`
    );
  }
  if (subject.squareFootage && comp.squareFootage) {
    const diff = comp.squareFootage - subject.squareFootage;
    const pct = ((Math.abs(diff) / subject.squareFootage) * 100).toFixed(0);
    pts.push(
      Math.abs(Number(pct)) < 5
        ? 'Very similar sqft'
        : `${diff > 0 ? '+' : ''}${fmtNum(diff)} sqft (${pct}%)`
    );
  }
  return pts;
}

function shortAnalysis(subject, comp, score) {
  const { label } = scoreLabel(score);
  const bedMatch = (comp.bedrooms || 0) === (subject.bedrooms || 0);
  const sp = subject._displayPrice;
  const cp = comp.price || comp.listPrice;
  const pDiff = sp && cp ? Math.abs(cp - sp) / sp : null;
  const sDiff =
    subject.squareFootage && comp.squareFootage
      ? Math.abs(comp.squareFootage - subject.squareFootage) /
        subject.squareFootage
      : null;

  let t = `${label} comparable. `;
  t += bedMatch ? 'Matches on bedroom count. ' : 'Different bedroom count. ';
  if (pDiff !== null)
    t +=
      pDiff < 0.05
        ? 'Price very close. '
        : pDiff < 0.15
        ? 'Price reasonably aligned. '
        : 'Price gap may need explanation. ';
  if (sDiff !== null)
    t += sDiff < 0.1 ? 'Size well-matched.' : 'Note size difference.';
  return t;
}

// ---------------------------------------------------------------------------
// API CALLS
// ---------------------------------------------------------------------------
const RADIUS_OPTIONS = [3, 5, 10, 15, 25];
const DEFAULT_RADIUS = 10;
const RENTCAST_HEADERS = { 'X-Api-Key': RENTCAST_KEY };

async function fetchSubjectProperty(address) {
  // First try listings API — gets active listing data including price
  const listingRes = await fetch(
    `https://api.rentcast.io/v1/listings/sale?address=${encodeURIComponent(address)}&status=Active&limit=1`,
    { headers: RENTCAST_HEADERS }
  );
  if (listingRes.ok) {
    const listingData = await listingRes.json();
    if (Array.isArray(listingData) && listingData.length > 0) {
      return { ...listingData[0], _isActiveListing: true };
    }
  }
  // Fallback: properties API for coordinates and details
  const res = await fetch(
    `https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}&limit=1`,
    { headers: RENTCAST_HEADERS }
  );
  if (res.ok) {
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0];
  }
  // Last fallback: city search for coordinates
  const cleanCity = address.trim().replace(/,?\s*CA$/i, '').trim();
  const cityRes = await fetch(
    `https://api.rentcast.io/v1/listings/sale?city=${encodeURIComponent(cleanCity)}&state=CA&limit=1`,
    { headers: RENTCAST_HEADERS }
  );
  const cityData = await cityRes.json();
  if (cityRes.ok && Array.isArray(cityData) && cityData.length > 0 && cityData[0].latitude) {
    return { latitude: cityData[0].latitude, longitude: cityData[0].longitude };
  }
  throw new Error('Location not found. Try typing just the city name, e.g. "Carlsbad"');
}




async function fetchActiveListings(lat, lng, radius) {
  const base = `https://api.rentcast.io/v1/listings/sale?latitude=${lat}&longitude=${lng}&radius=${radius}&status=Active&limit=500`;

  // FIX: was 3 fetches destructured into 2 variables; Townhouse was also missing headers
  const [cR, tR, sfR] = await Promise.all([
    fetch(base + '&propertyType=Condo', { headers: RENTCAST_HEADERS }),
    fetch(base + '&propertyType=Townhouse', { headers: RENTCAST_HEADERS }),
    fetch(base + '&propertyType=Single%20Family', { headers: RENTCAST_HEADERS }),
  ]);

  // FIX: was only awaiting 2 items but destructuring 3, so sfD was always undefined
  const [cD, tD, sfD] = await Promise.all([
    cR.ok ? cR.json() : [],
    tR.ok ? tR.json() : [],
    sfR.ok ? sfR.json() : [],
  ]);

  const all = [...(cD || []), ...(tD || []), ...(sfD || [])];
  const seen = new Set();
  return all.filter((p) => {
    const k = p.id || p.addressLine1 + p.zipCode;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function findSimilarHomes(subject, listings, radius, centerLat, centerLng) {
  centerLat = centerLat ?? subject.latitude;
  centerLng = centerLng ?? subject.longitude;
  const usingAltLocation = centerLat !== subject.latitude || centerLng !== subject.longitude;
  const subjectCity = (subject.city || '').toLowerCase();

  const sameCityResults = [];
  const otherResults = [];

  for (const comp of listings) {
    if (!comp.latitude || !comp.longitude) continue;
    const distToSubject = haversine(subject.latitude, subject.longitude, comp.latitude, comp.longitude);
    if (distToSubject < 0.02) continue;
    if (!typeCompatible(subject.propertyType, comp.propertyType)) continue;
    const distToCenter = haversine(centerLat, centerLng, comp.latitude, comp.longitude);
    if (!usingAltLocation && distToCenter > radius) continue;
    const score = scoreComp(subject, comp, distToSubject, radius);
    if (score === null) continue;
    const compCity = (comp.city || '').toLowerCase();
    if (compCity === subjectCity) {
      sameCityResults.push({ ...comp, _dist: distToSubject, _score: score });
    } else {
      otherResults.push({ ...comp, _dist: distToSubject, _score: score });
    }
  }

  sameCityResults.sort((a, b) => b._score - a._score);
  otherResults.sort((a, b) => b._score - a._score);

  const combined = sameCityResults.length >= 5
    ? sameCityResults.slice(0, 10)
    : [...sameCityResults, ...otherResults].slice(0, 10);

  return combined;
}
// ---------------------------------------------------------------------------
// SUBJECT PROPERTY CARD
// ---------------------------------------------------------------------------
function SubjectCard({ subject }) {
  const [expanded, setExpanded] = useState(false);
  const addr = buildAddress(subject);
  const url = zillowUrl(subject);
  const price = subject._displayPrice;

  return (
    <div
      style={{
        marginBottom: 12,
        background: '#1a2e1a',
        border: '2px solid #16a34a',
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <div
        style={{ padding: '14px 16px', cursor: 'pointer' }}
        onClick={() => setExpanded((e) => !e)}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span
              style={{
                background: '#16a34a',
                color: '#fff',
                padding: '2px 10px',
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 800,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              ★ SUBJECT
            </span>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: '#4ade80',
                fontWeight: 700,
                fontSize: 15,
                textDecoration: 'underline',
                wordBreak: 'break-word',
              }}
            >
              {addr}
            </a>
          </div>
          <span style={{ color: '#64748b', fontSize: 16, userSelect: 'none', flexShrink: 0 }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 8,
            flexWrap: 'wrap',
          }}
        >
          {price != null ? (
            <span style={{ color: '#4ade80', fontWeight: 800, fontSize: 17 }}>
              {fmt$(price)}
              <span style={{ color: '#86efac', fontSize: 11, marginLeft: 6, fontWeight: 400 }}>
                ({subject._displayPriceLabel})
              </span>
            </span>
          ) : (
            <span style={{ color: '#64748b', fontSize: 14 }}>Price unavailable</span>
          )}
          <span style={{ color: '#86efac', fontSize: 14 }}>
            {subject.bedrooms ?? '?'} bd · {subject.bathrooms ?? '?'} ba
            {subject.squareFootage ? ` · ${fmtNum(subject.squareFootage)} sqft` : ''}
          </span>
        </div>
      </div>
      {expanded && (
        <div
          style={{
            borderTop: '1px solid #166534',
            padding: '14px 16px',
            background: '#14231a',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {subject.propertyType && (
              <span
                style={{
                  background: '#1e3a5f',
                  color: '#93c5fd',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                }}
              >
                {subject.propertyType}
              </span>
            )}
            {subject.lastSaleDate && (
              <span
                style={{
                  background: '#1e293b',
                  color: '#94a3b8',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 11,
                }}
              >
                Sold{' '}
                {new Date(subject.lastSaleDate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// COMP CARD
// ---------------------------------------------------------------------------
function CompCard({ comp, subject, index, isSelected, onToggleSelect }) {
  const [expanded, setExpanded] = useState(false);
  const { label, color } = scoreLabel(comp._score);
  const addr = buildAddress(comp);
  const url = zillowUrl(comp);
  const diffs = keyDiffs(subject, comp);
  const points = talkingPoints(subject, comp);
  const analysis = shortAnalysis(subject, comp, comp._score);
  const compPrice = comp.price || comp.listPrice;

  return (
    <div
      style={{
        marginBottom: 12,
        background: isSelected ? '#1e1b4b' : '#1a1a2e',
        border: `2px solid ${isSelected ? '#6d28d9' : expanded ? '#4c4c72' : '#252538'}`,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <div
        style={{ padding: '14px 16px', cursor: 'pointer' }}
        onClick={() => setExpanded((e) => !e)}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(index)}
              onClick={(e) => e.stopPropagation()}
              style={{
                accentColor: '#7c3aed',
                width: 17,
                height: 17,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: '#a5b4fc',
                fontWeight: 700,
                fontSize: 15,
                textDecoration: 'underline',
                wordBreak: 'break-word',
              }}
            >
              {addr}
            </a>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <span
              style={{
                background: color + '22',
                color,
                border: `1px solid ${color}66`,
                padding: '3px 10px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {comp._score} · {label}
            </span>
            <span
              style={{
                background: '#1e3a5f',
                color: '#93c5fd',
                padding: '3px 10px',
                borderRadius: 20,
                fontSize: 12,
                whiteSpace: 'nowrap',
              }}
            >
              {comp._dist.toFixed(1)} mi
            </span>
            <span style={{ color: '#64748b', fontSize: 16, userSelect: 'none' }}>
              {expanded ? '▲' : '▼'}
            </span>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: '#f0fdf4', fontWeight: 800, fontSize: 17 }}>
            {fmt$(compPrice)}
          </span>
          <span style={{ color: '#94a3b8', fontSize: 14 }}>
            {comp.bedrooms ?? '?'} bd · {comp.bathrooms ?? '?'} ba
            {comp.squareFootage ? ` · ${fmtNum(comp.squareFootage)} sqft` : ''}
          </span>
        </div>
        {diffs.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {diffs.map((d, i) => (
              <span
                key={i}
                style={{
                  background: '#0f172a',
                  color: '#94a3b8',
                  padding: '3px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  border: '1px solid #1e293b',
                }}
              >
                {d}
              </span>
            ))}
          </div>
        )}
      </div>
      {expanded && (
        <div
          style={{
            borderTop: '1px solid #252538',
            padding: '14px 16px',
            background: '#14142a',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {comp.propertyType && (
              <span
                style={{
                  background: '#1e3a5f',
                  color: '#93c5fd',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                }}
              >
                {comp.propertyType}
              </span>
            )}
            {comp.daysOnMarket != null && (
              <span
                style={{
                  background: '#2d1a4e',
                  color: '#c4b5fd',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                }}
              >
                DOM: {comp.daysOnMarket}
              </span>
            )}
            {comp.listingId && (
              <span
                style={{
                  background: '#1a2e1a',
                  color: '#6ee7b7',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                }}
              >
                MLS# {comp.listingId}
              </span>
            )}
            {comp.listingAgent?.name && (
              <span
                style={{
                  background: '#1a2535',
                  color: '#94a3b8',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                }}
              >
                👤 {comp.listingAgent.name}
              </span>
            )}
            {comp.listingAgent?.phone && (
              <a
                href={`tel:${comp.listingAgent.phone}`}
                style={{
                  background: '#1a2535',
                  color: '#7dd3fc',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                  textDecoration: 'none',
                }}
              >
                📞 {comp.listingAgent.phone}
              </a>
            )}
            {(comp.openHouseDate || (comp.openHouseDates && comp.openHouseDates.length > 0)) && (
              <span
                style={{
                  background: '#1a2f1a',
                  color: '#6ee7b7',
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                }}
              >
                🏠 Open: {comp.openHouseDate || comp.openHouseDates[0]}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {points.map((pt, j) => (
              <span
                key={j}
                style={{
                  background: '#0f172a',
                  color: '#7dd3fc',
                  padding: '3px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  border: '1px solid #1e293b',
                }}
              >
                {pt}
              </span>
            ))}
          </div>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>
            {analysis}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AUTH SCREEN
// ---------------------------------------------------------------------------
function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleRegister(e) {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      setError('All fields are required.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const pwHash = await hashPassword(password);
      const { data: existArr } = await sbSelect('users', 'user_id', {
        email: email.trim().toLowerCase(),
      });
      if (existArr && existArr.length > 0) {
        setError('An account with this email already exists.');
        setLoading(false);
        return;
      }
      await sbInsert('users', {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password_hash: pwHash,
        search_count: 0,
        search_limit: 20,
      });
      setSuccess('Account created! You can now sign in.');
      setMode('login');
      setFullName('');
      setPassword('');
    } catch (err) {
      setError(err.message || 'Registration failed.');
    }
    setLoading(false);
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const pwHash = await hashPassword(password);
      const { data: loginResults } = await sbSelect('users', '*', {
        email: email.trim().toLowerCase(),
      });
      const data =
        loginResults && loginResults.length > 0
          ? loginResults.find((u) => u.password_hash === pwHash) || null
          : null;
      if (!data) {
        setError('Invalid email or password.');
        setLoading(false);
        return;
      }
      onLogin(data);
    } catch (err) {
      console.error(err);
      setError('Login failed. Please try again.');
    }
    setLoading(false);
  }

  const inp = {
    width: '100%',
    padding: '11px 14px',
    background: '#2d2d44',
    border: '1.5px solid #4c4c72',
    borderRadius: 10,
    color: '#e2e8f0',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  };
  const lbl = {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    color: '#94a3b8',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: 1,
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f0f1a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#a5b4fc' }}>
          ShowNext
        </h1>
        <p style={{ margin: '6px 0 0', color: '#6366f1', fontSize: 13 }}>
          Find similar active listings in seconds
        </p>
      </div>
      <div
        style={{
          background: '#1e1e2e',
          borderRadius: 16,
          padding: 28,
          width: '100%',
          maxWidth: 400,
          boxShadow: '0 4px 24px rgba(0,0,0,.5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 0,
            marginBottom: 22,
            background: '#14142a',
            borderRadius: 10,
            padding: 3,
          }}
        >
          {['login', 'register'].map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); setSuccess(''); }}
              style={{
                flex: 1,
                padding: '8px',
                border: 'none',
                borderRadius: 8,
                background: mode === m ? '#4f46e5' : 'transparent',
                color: mode === m ? '#fff' : '#94a3b8',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all .2s',
              }}
            >
              {m === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {error && (
          <div
            style={{
              background: '#450a0a',
              border: '1px solid #991b1b',
              borderRadius: 8,
              padding: '10px 14px',
              color: '#fca5a5',
              fontSize: 13,
              marginBottom: 14,
            }}
          >
            ⚠️ {error}
          </div>
        )}
        {success && (
          <div
            style={{
              background: '#052e16',
              border: '1px solid #166534',
              borderRadius: 8,
              padding: '10px 14px',
              color: '#86efac',
              fontSize: 13,
              marginBottom: 14,
            }}
          >
            ✓ {success}
          </div>
        )}

        <form onSubmit={mode === 'login' ? handleLogin : handleRegister}>
          {mode === 'register' && (
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Full Name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                style={inp}
              />
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="agent@example.com"
              style={inp}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={lbl}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inp}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: loading
                ? '#4c1d95'
                : 'linear-gradient(90deg,#6d28d9,#4f46e5)',
              border: 'none',
              borderRadius: 10,
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading
              ? mode === 'login' ? 'Signing in…' : 'Creating account…'
              : mode === 'login' ? 'Sign In →' : 'Create Free Account →'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: '#4c4c72' }}>
          Test limit: 20 searches · Track your comp searches · Free during beta
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AGENT DASHBOARD
// ---------------------------------------------------------------------------
function Dashboard({ user, onBack }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sbSelectOrdered('search_logs', '*', 'user_id', user.user_id, 'timestamp', false, 50).then(
      ({ data }) => {
        setLogs(data || []);
        setLoading(false);
      }
    );
  }, [user.user_id]);

  const used = user.search_count;
  const limit = user.search_limit;
  const pct = Math.round((used / limit) * 100);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f0f1a',
        color: '#e2e8f0',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg,#1e1b4b,#312e81)',
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#a5b4fc' }}>
            My Dashboard
          </h1>
          <p style={{ margin: '3px 0 0', color: '#c7d2fe', fontSize: 13 }}>
            Welcome, {user.full_name}
          </p>
        </div>
        <button
          onClick={onBack}
          style={{
            padding: '8px 16px',
            background: '#312e81',
            border: '1px solid #4f46e5',
            borderRadius: 8,
            color: '#a5b4fc',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ← Search
        </button>
      </div>

      <div style={{ maxWidth: 700, margin: '24px auto', padding: '0 16px' }}>
        <div
          style={{
            background: '#1e1e2e',
            borderRadius: 14,
            padding: 20,
            marginBottom: 20,
            border: '1px solid #252538',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0' }}>
              Searches Used
            </span>
            <span
              style={{
                fontWeight: 800,
                fontSize: 20,
                color: used >= limit ? '#ef4444' : '#a5b4fc',
              }}
            >
              {used} / {limit}
            </span>
          </div>
          <div
            style={{
              background: '#2d2d44',
              borderRadius: 99,
              height: 10,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: pct + '%',
                background:
                  used >= limit
                    ? 'linear-gradient(90deg,#dc2626,#ef4444)'
                    : 'linear-gradient(90deg,#6d28d9,#4f46e5)',
                borderRadius: 99,
                transition: 'width .4s',
              }}
            />
          </div>
          <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 12 }}>
            {limit - used} search{limit - used !== 1 ? 'es' : ''} remaining
          </p>
        </div>

        <h2 style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 700, color: '#a5b4fc' }}>
          Search History
        </h2>
        {loading && <p style={{ color: '#64748b', fontSize: 14 }}>Loading…</p>}
        {!loading && logs.length === 0 && (
          <p style={{ color: '#64748b', fontSize: 14 }}>No searches yet. Go find some comps!</p>
        )}
        {logs.map((log, i) => (
          <div
            key={i}
            style={{
              background: '#1a1a2e',
              border: '1px solid #252538',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>
                {log.address_searched}
              </div>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>
                {new Date(log.timestamp).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
            <span
              style={{
                background: '#1e3a5f',
                color: '#93c5fd',
                padding: '3px 10px',
                borderRadius: 20,
                fontSize: 12,
                whiteSpace: 'nowrap',
              }}
            >
              {log.api_calls_used} API calls
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MAIN APP
// ---------------------------------------------------------------------------
export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('search');
  const [query, setQuery] = useState('');
  const [altLocation, setAltLocation] = useState('');
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [subject, setSubject] = useState(null);
  const [comps, setComps] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function refreshUser(userId) {
    const { data: userData } = await sbSelect('users', '*', { user_id: userId }, true);
    if (userData) setUser(userData);
    return userData;
  }

  function handleLogin(userData) {
    setUser(userData);
    setView('search');
  }

  function handleLogout() {
    setUser(null);
    setView('search');
    setSubject(null);
    setComps([]);
    setSelected(new Set());
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!user) return;
    const searchAddress = query.trim();
    if (!searchAddress) return;

    const freshUser = await refreshUser(user.user_id);
    if (freshUser.search_count >= freshUser.search_limit) {
      setError(
        'Test limit reached. You have used your ' + freshUser.search_limit + ' searches.'
      );
      return;
    }

    setLoading(true);
    setError('');
    setComps([]);
    setSelected(new Set());
    setSubject(null);
    let apiCallsUsed = 0;

    try {
      setLoadingMsg('Looking up subject property…');
      let subjectProp = await fetchSubjectProperty(searchAddress);
      apiCallsUsed++;

    



      

      let searchLat = subjectProp.latitude;
      let searchLng = subjectProp.longitude;
      if (altLocation.trim()) {
        setLoadingMsg('Looking up search location…');
        const altProp = await fetchSubjectProperty(altLocation.trim());
        apiCallsUsed++;
        searchLat = altProp.latitude;
        searchLng = altProp.longitude;
      }

      if (subjectProp._isActiveListing) {
        subjectProp = {
          ...subjectProp,
          _displayPrice: subjectProp.price || subjectProp.listPrice,
          _displayPriceLabel: 'List Price',
        };
      } else {
        subjectProp = {
          ...subjectProp,
          _displayPrice: subjectProp.lastSalePrice || null,
          _displayPriceLabel: subjectProp.lastSalePrice ? 'Last Sale · Listing may not be active' : 'Price unavailable · Listing may not be active',
        };
      }
      setSubject(subjectProp);
      setLoadingMsg('Searching for similar active sale listings…');
      const listings = await fetchActiveListings(searchLat, searchLng, radius);
      apiCallsUsed += 3; // now correctly counting all 3 property type fetches

    
      const ranked = findSimilarHomes(subjectProp, listings, radius, searchLat, searchLng);
      setComps(ranked);

      await sbInsert('search_logs', {
        user_id: user.user_id,
        address_searched: searchAddress,
        api_calls_used: apiCallsUsed,
      });
      await sbUpdate(
        'users',
        { search_count: freshUser.search_count + 1 },
        'user_id',
        user.user_id
      );
      await refreshUser(user.user_id);

      if (ranked.length === 0)
        setError('No similar active listings found. Try a larger radius.');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    }

    setLoading(false);
    setLoadingMsg('');
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function selectAll() { setSelected(new Set(comps.map((_, i) => i))); }
  function clearAll() { setSelected(new Set()); }

  const selectedComps = useMemo(
    () => comps.filter((_, i) => selected.has(i)),
    [comps, selected]
  );

  function buildClientMessageText() {
    if (!subject || selectedComps.length === 0) return '';
    const lines = selectedComps
      .map((c) => {
        const addr = buildAddress(c);
        const price = fmt$(c.price || c.listPrice);
        const beds = c.bedrooms ?? '?';
        const baths = c.bathrooms ?? '?';
        const sqft = c.squareFootage ? fmtNum(c.squareFootage) : '?';
        const url = zillowUrl(c);
        return `• ${addr} — ${price} | ${beds} bed / ${baths} bath | ${sqft} sqft\n  ${url}`;
      })
      .join('\n');
    return `Hi! Here are some similar homes for sale to ${query.trim()} that I thought you'd find interesting:\n\n${lines}\n\nWould you like to tour any of these? Let me know and I'll set it up!`;
  }

  function buildClientMessageHTML() {
    if (!subject || selectedComps.length === 0) return '';
    const items = selectedComps
      .map((c) => {
        const addr = buildAddress(c);
        const price = fmt$(c.price || c.listPrice);
        const beds = c.bedrooms ?? '?';
        const baths = c.bathrooms ?? '?';
        const sqft = c.squareFootage ? fmtNum(c.squareFootage) : '?';
        const url = zillowUrl(c);
        return `<li><a href="${url}">${addr}</a> — ${price} | ${beds} bed / ${baths} bath | ${sqft} sqft</li>`;
      })
      .join('');
    return `<p>Hi! Here are some similar homes to <a href="${zillowUrl(subject)}">${query.trim()}</a> that I thought you'd find interesting:</p><ul>${items}</ul><p>Would you like to tour any of these? Let me know and I'll set it up!</p>`;
  }

  function copyMessage(asHtml) {
    if (asHtml) {
      const html = buildClientMessageHTML();
      const text = buildClientMessageText();
      if (!html) return;
      try {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        });
        navigator.clipboard.write([item]).then(() => {
          setCopied('html');
          setTimeout(() => setCopied(false), 2500);
        });
      } catch (_) {
        navigator.clipboard.writeText(text).then(() => {
          setCopied('text');
          setTimeout(() => setCopied(false), 2500);
        });
      }
    } else {
      const msg = buildClientMessageText();
      if (!msg) return;
      navigator.clipboard.writeText(msg).then(() => {
        setCopied('text');
        setTimeout(() => setCopied(false), 2500);
      });
    }
  }

  if (!user) return <AuthScreen onLogin={handleLogin} />;
  if (view === 'dashboard')
    return <Dashboard user={user} onBack={() => setView('search')} />;

  const limitReached = user.search_count >= user.search_limit;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f0f1a',
        color: '#e2e8f0',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* HEADER */}
      <div
        style={{
          background: 'linear-gradient(135deg,#1e1b4b,#312e81)',
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#a5b4fc' }}>
            ShowNext
          </h1>
          <p style={{ margin: '2px 0 0', color: '#c7d2fe', fontSize: 12 }}>
            Find similar active listings in seconds
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setView('dashboard')}
            style={{
              padding: '7px 14px',
              background: '#312e81',
              border: '1px solid #4f46e5',
              borderRadius: 8,
              color: '#a5b4fc',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📊 {user.search_count}/{user.search_limit} searches
          </button>
          <span style={{ color: '#6366f1', fontSize: 13, fontWeight: 600 }}>
            {user.full_name}
          </span>
          <button
            onClick={handleLogout}
            style={{
              padding: '7px 12px',
              background: '#1e1e2e',
              border: '1px solid #4c4c72',
              borderRadius: 8,
              color: '#94a3b8',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 700, margin: '24px auto', padding: '0 16px' }}>
        {limitReached && (
          <div
            style={{
              background: '#450a0a',
              border: '1px solid #991b1b',
              borderRadius: 12,
              padding: '16px 20px',
              marginBottom: 18,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fca5a5', marginBottom: 4 }}>
              🔒 Test limit reached
            </div>
            <p style={{ margin: 0, color: '#fca5a5', fontSize: 14 }}>
              You have used your {user.search_limit} searches. Contact us to get more access.
            </p>
          </div>
        )}

        {/* SEARCH FORM */}
        <form
          onSubmit={handleSearch}
          style={{
            background: '#1e1e2e',
            borderRadius: 16,
            padding: 22,
            boxShadow: '0 4px 24px rgba(0,0,0,.4)',
            opacity: limitReached ? 0.5 : 1,
          }}
        >
          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 700,
              color: '#a5b4fc',
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            Subject Property Address
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Address"
            disabled={limitReached}
            style={{
              width: '100%',
              padding: '12px 14px',
              background: '#2d2d44',
              border: '1.5px solid #4c4c72',
              borderRadius: 10,
              color: '#e2e8f0',
              fontSize: 15,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 700,
              color: '#94a3b8',
              marginTop: 14,
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            Search Comps in Different Location{' '}
            <span style={{ color: '#64748b', fontWeight: 400, textTransform: 'none' }}>
              (optional)
            </span>
          </label>
          <input
            value={altLocation}
            onChange={(e) => setAltLocation(e.target.value)}
            placeholder="City, State  or  full address"
            disabled={limitReached}
            style={{
              width: '100%',
              padding: '11px 14px',
              background: '#2d2d44',
              border: '1.5px solid #4c4c72',
              borderRadius: 10,
              color: '#e2e8f0',
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 11 }}>
            Leave blank to search near the subject property
          </p>

          <div style={{ marginTop: 14 }}>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 700,
                color: '#94a3b8',
                marginBottom: 7,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              Search Radius
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRadius(r)}
                  disabled={limitReached}
                  style={{
                    padding: '7px 16px',
                    background: radius === r ? '#4f46e5' : '#2d2d44',
                    border: radius === r ? '2px solid #818cf8' : '2px solid #4c4c72',
                    borderRadius: 8,
                    color: radius === r ? '#fff' : '#94a3b8',
                    fontSize: 13,
                    fontWeight: radius === r ? 700 : 400,
                    cursor: limitReached ? 'not-allowed' : 'pointer',
                  }}
                >
                  {r} mi
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim() || limitReached}
            style={{
              marginTop: 18,
              width: '100%',
              padding: '13px',
              background: loading
                ? '#4c1d95'
                : limitReached
                ? '#1e1e2e'
                : 'linear-gradient(90deg,#6d28d9,#4f46e5)',
              border: limitReached ? '1px solid #4c4c72' : 'none',
              borderRadius: 10,
              color: limitReached ? '#64748b' : '#fff',
              fontSize: 16,
              fontWeight: 700,
              cursor: loading || limitReached ? 'not-allowed' : 'pointer',
            }}
          >
            {loading
              ? loadingMsg || 'Searching…'
              : limitReached
              ? '🔒 Limit Reached'
              : '🔍  Find Similar Homes'}
          </button>
        </form>

        {error && !limitReached && (
          <div
            style={{
              marginTop: 14,
              background: '#450a0a',
              border: '1px solid #991b1b',
              borderRadius: 10,
              padding: '13px 16px',
              color: '#fca5a5',
              fontSize: 14,
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {comps.length > 0 && !loading && (
          <div style={{ marginTop: 22 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#a5b4fc' }}>
                {comps.length} Similar Active Listings
              </h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={selectAll}
                  style={{
                    padding: '5px 12px',
                    background: '#312e81',
                    border: '1px solid #4f46e5',
                    borderRadius: 8,
                    color: '#a5b4fc',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Select All
                </button>
                <button
                  onClick={clearAll}
                  style={{
                    padding: '5px 12px',
                    background: '#1e1e2e',
                    border: '1px solid #4c4c72',
                    borderRadius: 8,
                    color: '#94a3b8',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            <p style={{ margin: '0 0 14px', color: '#4c4c72', fontSize: 12 }}>
              Tap a card to expand details · Tap address to view listing
            </p>
            {subject && <SubjectCard subject={subject} />}
            {comps.map((comp, i) => (
              <CompCard
                key={i}
                comp={comp}
                subject={subject}
                index={i}
                isSelected={selected.has(i)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        )}

        {!subject && !loading && (
          <div style={{ marginTop: 32, textAlign: 'center', color: '#4c4c72', fontSize: 13 }}>
            <p>Enter an address to find similar active listings</p>
            <p style={{ marginTop: 4 }}>Powered by Rentcast · Data updates daily</p>
          </div>
        )}
        <div style={{ height: 120 }} />
      </div>

      {selected.size > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'linear-gradient(90deg,#1e1b4b,#312e81)',
            borderTop: '1px solid #4f46e5',
            padding: '13px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            zIndex: 100,
            boxShadow: '0 -4px 20px rgba(0,0,0,.5)',
          }}
        >
          <span style={{ color: '#c7d2fe', fontWeight: 600, fontSize: 14 }}>
            {selected.size} propert{selected.size === 1 ? 'y' : 'ies'} selected
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => copyMessage(true)}
              style={{
                padding: '9px 16px',
                background:
                  copied === 'html'
                    ? '#16a34a'
                    : 'linear-gradient(90deg,#7c3aed,#4f46e5)',
                border: 'none',
                borderRadius: 10,
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {copied === 'html' ? '✓ Copied!' : '✉️ Copy for Email'}
            </button>
            <button
              onClick={() => copyMessage(false)}
              style={{
                padding: '9px 16px',
                background: copied === 'text' ? '#16a34a' : '#2d2d44',
                border: '1px solid #4c4c72',
                borderRadius: 10,
                color: '#e2e8f0',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {copied === 'text' ? '✓ Copied!' : '📋 Copy as Text'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
