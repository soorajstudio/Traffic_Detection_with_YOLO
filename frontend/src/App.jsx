import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';

// ── Global settings state (lifted up so all pages share it) ─────
const defaultSettings = {
  theme:             'dark',
  accentColor:       'violet',
  fontSize:          'md',
  animationsEnabled: true,
  compactMode:       false,
  showGrid:          true,
  sidebarCollapsed:  false,
  progressStyle:     'ring',    // ring | bar
  detectionConf:     25,        // 0–100
  backendUrl:        'http://localhost:5000',
};

// ── Demo simulation engine ──────────────────────────────────────
// Generates realistic detection results when the Python backend is unavailable
function generateDemoStats(filename, durationSec) {
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const fps = [24, 25, 30][rand(0, 2)];
  const totalFrames = Math.round(durationSec * fps);
  const cars = rand(4, 28);
  const trucks = rand(0, 8);
  const buses = rand(0, 4);
  const motorcycles = rand(0, 6);
  const bicycles = rand(0, 3);
  const pedestrians = rand(2, 15);
  const trafficLights = rand(0, 3);
  const animals = rand(0, 2);
  const totalVehicles = cars + trucks + buses + motorcycles;
  const vehiclesCrossed = rand(Math.floor(totalVehicles * 0.3), totalVehicles);
  const vpm = durationSec > 0 ? Math.round((vehiclesCrossed / durationSec) * 60) : 0;
  const density = vpm > 30 ? 'HIGH' : vpm > 12 ? 'MODERATE' : 'LOW';
  const statusMap = { HIGH: 'Heavy Traffic Detected', MODERATE: 'Moderate Traffic Flow', LOW: 'Light Traffic Conditions' };
  const avgSpeed = rand(18, 65);
  const maxSpeed = avgSpeed + rand(10, 40);
  const mins = Math.floor(durationSec / 60);
  const secs = Math.round(durationSec % 60);
  return {
    cars, pedestrians, trucks, buses, motorcycles, bicycles,
    traffic_lights: trafficLights, animals,
    avg_speed: avgSpeed, max_speed: maxSpeed,
    vehicles_crossed_line: vehiclesCrossed,
    vehicles_per_minute: vpm,
    traffic_density: density,
    traffic_status: statusMap[density],
    duration: `${mins}m ${secs}s`,
    resolution: ['1280×720', '1920×1080', '854×480'][rand(0, 2)],
    fps, total_frames: totalFrames,
    filename, processedAt: new Date().toLocaleString(),
  };
}

function runDemoSimulation({ file, onProgress, onFrame, onComplete }) {
  let cancelled = false;
  const totalFakeFrames = 120 + Math.floor(Math.random() * 180);
  let frame = 0;
  const interval = setInterval(() => {
    if (cancelled) return;
    frame += Math.floor(Math.random() * 4) + 1;
    if (frame >= totalFakeFrames) frame = totalFakeFrames;
    const pct = Math.min((frame / totalFakeFrames) * 100, frame >= totalFakeFrames ? 100 : 99);
    onProgress(pct);
    onFrame(frame, totalFakeFrames);
    if (frame >= totalFakeFrames) {
      clearInterval(interval);
      // Determine approximate duration from the video file
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const dur = video.duration || 10;
        URL.revokeObjectURL(video.src);
        const stats = generateDemoStats(file.name, dur);
        onComplete(stats);
      };
      video.onerror = () => {
        const stats = generateDemoStats(file.name, 15);
        onComplete(stats);
      };
      video.src = URL.createObjectURL(file);
    }
  }, 50);
  return () => { cancelled = true; clearInterval(interval); };
}

function applySettings(settings) {
  const r = document.documentElement;
  r.setAttribute('data-theme',    settings.theme);
  r.setAttribute('data-accent',   settings.accentColor);
  r.setAttribute('data-fontsize', settings.fontSize);
  r.setAttribute('data-grid',     settings.showGrid    ? '1' : '0');
  r.setAttribute('data-compact',  settings.compactMode ? '1' : '0');
  r.setAttribute('data-anim',     settings.animationsEnabled ? '1' : '0');
}

// ── Tiny reusable widgets ────────────────────────────────────────
function RadarRing({ active }) {
  return (
    <div className={`radar ${active ? 'radar--active' : ''}`}>
      <div className="radar-ring r1" /><div className="radar-ring r2" /><div className="radar-ring r3" />
      <div className="radar-dot" />
    </div>
  );
}

function StatChip({ label, value, color, icon }) {
  return (
    <div className="stat-chip">
      <span className="stat-chip-icon">{icon}</span>
      <div className="stat-chip-body">
        <span className="stat-chip-val" style={{ color }}>{value}</span>
        <span className="stat-chip-label">{label}</span>
      </div>
    </div>
  );
}

// ── Processing overlay ───────────────────────────────────────────
function ProcessingOverlay({ progress, frameCount, totalFrames, style }) {
  return (
    <div className="proc-overlay">
      <div className="proc-vignette" />
      <div className="target tl"><span /><span /></div>
      <div className="target tr"><span /><span /></div>
      <div className="target bl"><span /><span /></div>
      <div className="target br"><span /><span /></div>
      <div className="hud-tl"><span className="hud-label">FRAME</span><span className="hud-val">{frameCount.toLocaleString()} / {totalFrames.toLocaleString()}</span></div>
      <div className="hud-tr"><span className="hud-label">STATUS</span><span className="hud-val blink-text">ANALYZING</span></div>
      <div className="hud-bl"><span className="hud-label">MODEL</span><span className="hud-val">YOLOv8n</span></div>
      <div className="hud-br"><span className="hud-label">PROGRESS</span><span className="hud-val">{Math.round(progress)}%</span></div>
      {style === 'ring' ? (
        <div className="prog-center">
          <svg viewBox="0 0 100 100" className="prog-ring-svg">
            <circle cx="50" cy="50" r="38" className="prog-track" />
            <circle cx="50" cy="50" r="38" className="prog-fill"
              strokeDasharray={`${2 * Math.PI * 38}`}
              strokeDashoffset={`${2 * Math.PI * 38 * (1 - progress / 100)}`}
            />
          </svg>
          <div className="prog-text">
            <span className="prog-pct">{Math.round(progress)}%</span>
            <span className="prog-sub">PROCESSING</span>
          </div>
        </div>
      ) : (
        <div className="prog-bar-overlay">
          <div className="prog-bar-track"><div className="prog-bar-fill" style={{ width: `${progress}%` }} /></div>
          <span className="prog-bar-label">{Math.round(progress)}% · FRAME {frameCount.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

// ── Analysis panel ───────────────────────────────────────────────
function AnalysisPanel({ analysis, videoUrl, demo }) {
  const trafficColor = analysis.traffic_density === 'HIGH' ? '#f87171' : analysis.traffic_density === 'MODERATE' ? '#f59e0b' : '#34d399';
  return (
    <div className="analysis-panel anim-fadein">
      <div className="analysis-header">
        <span className="analysis-title">DETECTION REPORT{demo ? ' · DEMO' : ''}</span>
        <span className="analysis-time">{analysis.processedAt}</span>
      </div>
      {demo && (
        <div className="demo-banner">
          <span className="demo-banner-icon">&#9432;</span>
          <span>Demo mode — backend offline. Results are simulated. Run <code>python app.py</code> locally for real YOLOv8 detection.</span>
        </div>
      )}
      <div className="analysis-video-wrap">
        <video src={videoUrl} autoPlay loop muted controls className="analysis-video" />
        <div className="analysis-video-badge">● ANNOTATED OUTPUT</div>
      </div>
      <div className="traffic-banner" style={{ borderColor: trafficColor, background: `${trafficColor}11` }}>
        <span className="traffic-icon">{analysis.traffic_density === 'HIGH' ? '🔴' : analysis.traffic_density === 'MODERATE' ? '🟡' : '🟢'}</span>
        <div style={{ flex: 1 }}>
          <div className="traffic-status" style={{ color: trafficColor }}>{analysis.traffic_status}</div>
          <div className="traffic-sub">Density: <b>{analysis.traffic_density}</b> · {analysis.vehicles_crossed_line} vehicles crossed line · {analysis.vehicles_per_minute} vehicles/min</div>
        </div>
      </div>
      <div className="analysis-section-title">DETECTED OBJECTS <span className="section-sub">(unique tracked IDs)</span></div>
      <div className="stat-chips-grid">
        <StatChip label="Cars"           value={analysis.cars}          color="#34d399" icon="🚗" />
        <StatChip label="Pedestrians"    value={analysis.pedestrians}   color="#a78bfa" icon="🚶" />
        <StatChip label="Trucks"         value={analysis.trucks}        color="#f59e0b" icon="🚛" />
        <StatChip label="Buses"          value={analysis.buses}         color="#60a5fa" icon="🚌" />
        <StatChip label="Motorcycles"    value={analysis.motorcycles}   color="#fb923c" icon="🏍" />
        <StatChip label="Bicycles"       value={analysis.bicycles}      color="#e879f9" icon="🚲" />
        <StatChip label="Traffic Lights" value={analysis.traffic_lights}color="#facc15" icon="🚦" />
        <StatChip label="Animals"        value={analysis.animals}       color="#f87171" icon="🐾" />
      </div>
      <div className="analysis-section-title">SPEED & FLOW METRICS</div>
      <div className="metrics-grid">
        <div className="metric-box"><span className="metric-val">{analysis.avg_speed ?? '—'}<span className="metric-unit"> km/h</span></span><span className="metric-label">Avg Speed</span></div>
        <div className="metric-box"><span className="metric-val">{analysis.max_speed ?? '—'}<span className="metric-unit"> km/h</span></span><span className="metric-label">Max Speed</span></div>
        <div className="metric-box"><span className="metric-val">{analysis.vehicles_crossed_line}</span><span className="metric-label">Crossed Line</span></div>
        <div className="metric-box"><span className="metric-val">{analysis.vehicles_per_minute}<span className="metric-unit"> /min</span></span><span className="metric-label">Flow Rate</span></div>
      </div>
      <div className="analysis-section-title">VIDEO METADATA</div>
      <div className="kv-table">
        <span className="kv-k">Duration</span>    <span className="kv-v">{analysis.duration}</span>
        <span className="kv-k">Resolution</span>  <span className="kv-v">{analysis.resolution}</span>
        <span className="kv-k">Frame Rate</span>  <span className="kv-v">{analysis.fps} FPS</span>
        <span className="kv-k">Total Frames</span><span className="kv-v">{analysis.total_frames?.toLocaleString()}</span>
        <span className="kv-k">Model</span>       <span className="kv-v">YOLOv8n</span>
        <span className="kv-k">Codec</span>       <span className="kv-v">H.264 / AVC1</span>
      </div>
    </div>
  );
}

// ── Live backend preview modal ───────────────────────────────────
function LivePreviewModal({ jpegB64, frame, totalFrames, onClose }) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  const pct = totalFrames > 0 ? Math.round((frame / totalFrames) * 100) : 0;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box modal-box--live" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">● LIVE BACKEND PREVIEW · FRAME {frame.toLocaleString()} / {totalFrames.toLocaleString()}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="live-preview-body">
          {jpegB64
            ? <img src={`data:image/jpeg;base64,${jpegB64}`} alt="Live frame" className="live-preview-img" />
            : <div className="live-preview-waiting"><span className="spinner" /> &nbsp; Waiting for first frame…</div>
          }
          <div className="live-preview-note">The <b style={{color:'#facc15'}}>yellow line</b> is the vehicle counting line — objects crossing it are counted toward traffic flow.</div>
        </div>
        <div className="live-progress-bar-wrap"><div className="live-progress-bar" style={{ width: `${pct}%` }} /></div>
        <div className="modal-footer">
          <span className="modal-badge">⬤ PROCESSING {pct}%</span>
          <span className="modal-hint">ESC to close · updates every ~8 frames</span>
        </div>
      </div>
    </div>
  );
}

// ── History modal ────────────────────────────────────────────────
function HistoryModal({ item, onClose }) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  const { analysis, url } = item;
  const trafficColor = analysis.traffic_density === 'HIGH' ? '#f87171' : analysis.traffic_density === 'MODERATE' ? '#f59e0b' : '#34d399';
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box modal-box--history" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{analysis.filename}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-left">
            <video src={url} autoPlay loop controls className="modal-video" />
            <div className="traffic-banner" style={{ borderColor: trafficColor, background: `${trafficColor}11`, marginTop: 12 }}>
              <span className="traffic-icon">{analysis.traffic_density === 'HIGH' ? '🔴' : analysis.traffic_density === 'MODERATE' ? '🟡' : '🟢'}</span>
              <div>
                <div className="traffic-status" style={{ color: trafficColor }}>{analysis.traffic_status}</div>
                <div className="traffic-sub">{analysis.vehicles_crossed_line} crossed · {analysis.vehicles_per_minute} /min</div>
              </div>
            </div>
          </div>
          <div className="modal-right">
            <div className="analysis-section-title">DETECTED OBJECTS</div>
            <div className="stat-chips-grid stat-chips-grid--2col">
              <StatChip label="Cars"           value={analysis.cars}          color="#34d399" icon="🚗" />
              <StatChip label="Pedestrians"    value={analysis.pedestrians}   color="#a78bfa" icon="🚶" />
              <StatChip label="Trucks"         value={analysis.trucks}        color="#f59e0b" icon="🚛" />
              <StatChip label="Buses"          value={analysis.buses}         color="#60a5fa" icon="🚌" />
              <StatChip label="Motorcycles"    value={analysis.motorcycles}   color="#fb923c" icon="🏍" />
              <StatChip label="Bicycles"       value={analysis.bicycles}      color="#e879f9" icon="🚲" />
              <StatChip label="Traffic Lights" value={analysis.traffic_lights}color="#facc15" icon="🚦" />
              <StatChip label="Animals"        value={analysis.animals}       color="#f87171" icon="🐾" />
            </div>
            <div className="analysis-section-title" style={{ marginTop: 14 }}>SPEED & FLOW</div>
            <div className="metrics-grid">
              <div className="metric-box"><span className="metric-val">{analysis.avg_speed ?? '—'}<span className="metric-unit"> km/h</span></span><span className="metric-label">Avg Speed</span></div>
              <div className="metric-box"><span className="metric-val">{analysis.max_speed ?? '—'}<span className="metric-unit"> km/h</span></span><span className="metric-label">Max Speed</span></div>
              <div className="metric-box"><span className="metric-val">{analysis.vehicles_crossed_line}</span><span className="metric-label">Crossed</span></div>
              <div className="metric-box"><span className="metric-val">{analysis.vehicles_per_minute}<span className="metric-unit"> /min</span></span><span className="metric-label">Flow</span></div>
            </div>
            <div className="analysis-section-title" style={{ marginTop: 14 }}>METADATA</div>
            <div className="kv-table">
              <span className="kv-k">Processed</span>  <span className="kv-v">{analysis.processedAt}</span>
              <span className="kv-k">Duration</span>   <span className="kv-v">{analysis.duration}</span>
              <span className="kv-k">Resolution</span> <span className="kv-v">{analysis.resolution}</span>
              <span className="kv-k">FPS</span>        <span className="kv-v">{analysis.fps}</span>
              <span className="kv-k">Frames</span>     <span className="kv-v">{analysis.total_frames?.toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <span className="modal-badge">● DETECTION COMPLETE</span>
          <span className="modal-hint">ESC to close</span>
        </div>
      </div>
    </div>
  );
}

// ── Settings page ────────────────────────────────────────────────
function SettingsPage({ settings, setSettings }) {
  const set = (key, val) => {
    const next = { ...settings, [key]: val };
    setSettings(next);
    applySettings(next);
  };

  const Row = ({ label, desc, children }) => (
    <div className="settings-row">
      <div className="settings-row-label">
        <span className="settings-label">{label}</span>
        {desc && <span className="settings-desc">{desc}</span>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
  const Seg = ({ options, value, onChange }) => (
    <div className="seg-control">
      {options.map(o => (
        <button key={o.value} className={`seg-btn ${value === o.value ? 'seg-btn--active' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
  const Toggle = ({ value, onChange }) => (
    <button className={`toggle ${value ? 'toggle--on' : ''}`} onClick={() => onChange(!value)}>
      <span className="toggle-thumb" />
    </button>
  );
  const Slider = ({ value, onChange, min, max, step, unit }) => (
    <div className="slider-wrap">
      <input type="range" className="slider" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} />
      <span className="slider-val">{value}{unit}</span>
    </div>
  );

  return (
    <main className="settings-page anim-fadein">
      <div className="settings-page-header">
        <span className="history-title">SYSTEM SETTINGS</span>
        <span className="history-count">Customise your PERCEPT experience</span>
      </div>

      <div className="settings-grid">
        {/* LEFT COLUMN */}
        <div className="settings-col">
          <div className="settings-section">
            <div className="settings-section-title">🎨 APPEARANCE</div>
            <Row label="Theme" desc="Controls background and surface colours">
              <Seg value={settings.theme} onChange={v => set('theme', v)}
                options={[{label:'☀ Light',value:'light'},{label:'◑ Dim',value:'dim'},{label:'● Dark',value:'dark'}]} />
            </Row>
            <Row label="Accent Colour" desc="Used for buttons, highlights and glow">
              <div className="color-swatches">
                {[{value:'violet',color:'#a78bfa'},{value:'cyan',color:'#22d3ee'},{value:'green',color:'#34d399'},{value:'amber',color:'#f59e0b'},{value:'rose',color:'#f43f5e'}].map(({value,color}) => (
                  <button key={value} className={`color-swatch ${settings.accentColor===value?'color-swatch--active':''}`}
                    style={{background:color,boxShadow:settings.accentColor===value?`0 0 12px ${color}`:'none'}}
                    onClick={() => set('accentColor', value)} />
                ))}
              </div>
            </Row>
            <Row label="Font Size" desc="Base text size across the interface">
              <Seg value={settings.fontSize} onChange={v => set('fontSize', v)}
                options={[{label:'Small',value:'sm'},{label:'Medium',value:'md'},{label:'Large',value:'lg'}]} />
            </Row>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">🖥 DISPLAY</div>
            <Row label="Background Grid" desc="Dot-grid pattern on background">
              <Toggle value={settings.showGrid} onChange={v => set('showGrid', v)} />
            </Row>
            <Row label="Animations & Transitions" desc="Page fades, hover effects, glow pulses">
              <Toggle value={settings.animationsEnabled} onChange={v => set('animationsEnabled', v)} />
            </Row>
            <Row label="Compact Mode" desc="Reduces padding for denser layout">
              <Toggle value={settings.compactMode} onChange={v => set('compactMode', v)} />
            </Row>
            <Row label="Sidebar Collapsed" desc="Hides detection class list on detection page">
              <Toggle value={settings.sidebarCollapsed} onChange={v => set('sidebarCollapsed', v)} />
            </Row>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">⚙ PROCESSING</div>
            <Row label="Progress Style" desc="Visual style for the processing overlay">
              <Seg value={settings.progressStyle} onChange={v => set('progressStyle', v)}
                options={[{label:'Ring',value:'ring'},{label:'Bar',value:'bar'}]} />
            </Row>
            <Row label="Detection Confidence" desc="Minimum YOLO confidence threshold">
              <Slider value={settings.detectionConf} onChange={v => set('detectionConf', v)} min={5} max={95} step={5} unit="%" />
            </Row>
            <Row label="Backend URL" desc="Flask server endpoint">
              <input className="settings-input" value={settings.backendUrl}
                onChange={e => set('backendUrl', e.target.value)} />
            </Row>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="settings-col">
          <div className="settings-section">
            <div className="settings-section-title">👁 PREVIEW</div>
            <div className="settings-preview-card">
              <div className="preview-topbar-mock">
                <div className="ptm-dot" style={{background:'var(--accent)'}} />
                <span className="ptm-label">PERCEPT</span>
                <div className="ptm-status">⬤ READY</div>
              </div>
              <div className="preview-body-mock">
                <div className="pbm-sidebar">
                  {['PERSON','CAR','TRUCK','BUS'].map(l => (
                    <div key={l} className="pbm-row"><div className="pbm-pip" /><span>{l}</span></div>
                  ))}
                </div>
                <div className="pbm-feed">
                  <div className="pbm-feed-inner">
                    <div className="pbm-label">LIVE FEED</div>
                    <div className="pbm-placeholder">DROP VIDEO HERE</div>
                  </div>
                </div>
              </div>
            </div>
            <p className="settings-preview-hint">Live preview of current theme & accent</p>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">📊 CURRENT VALUES</div>
            <div className="kv-table">
              <span className="kv-k">Theme</span>         <span className="kv-v">{settings.theme.toUpperCase()}</span>
              <span className="kv-k">Accent</span>        <span className="kv-v">{settings.accentColor.toUpperCase()}</span>
              <span className="kv-k">Font Size</span>     <span className="kv-v">{settings.fontSize.toUpperCase()}</span>
              <span className="kv-k">Animations</span>    <span className="kv-v" style={{color: settings.animationsEnabled ? '#34d399' : '#f87171'}}>{settings.animationsEnabled ? 'ON' : 'OFF'}</span>
              <span className="kv-k">Compact</span>       <span className="kv-v" style={{color: settings.compactMode ? '#34d399' : '#f87171'}}>{settings.compactMode ? 'ON' : 'OFF'}</span>
              <span className="kv-k">Grid</span>          <span className="kv-v" style={{color: settings.showGrid ? '#34d399' : '#f87171'}}>{settings.showGrid ? 'ON' : 'OFF'}</span>
              <span className="kv-k">Conf. Threshold</span><span className="kv-v">{settings.detectionConf}%</span>
              <span className="kv-k">Progress Style</span><span className="kv-v">{settings.progressStyle.toUpperCase()}</span>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">ℹ ABOUT</div>
            <div className="kv-table">
              <span className="kv-k">App</span>        <span className="kv-v">PERCEPT v2.4</span>
              <span className="kv-k">Model</span>      <span className="kv-v">YOLOv8n</span>
              <span className="kv-k">Framework</span>  <span className="kv-v">React 18 + Flask</span>
              <span className="kv-k">CV Engine</span>  <span className="kv-v">OpenCV 4.x</span>
              <span className="kv-k">Tracker</span>    <span className="kv-v">ByteTrack</span>
            </div>
            <button className="btn btn-ghost" style={{marginTop:10,width:'100%'}} onClick={() => {
              setSettings(defaultSettings); applySettings(defaultSettings);
            }}>↺ Reset to Defaults</button>
          </div>
        </div>
      </div>
    </main>
  );
}

// ── INTRO / LANDING PAGE ─────────────────────────────────────────
function IntroPage({ onEnter }) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!document.querySelector('script[data-spline]')) {
      const s = document.createElement('script');
      s.type = 'module';
      s.src  = 'https://unpkg.com/@splinetool/viewer@1.12.68/build/spline-viewer.js';
      s.setAttribute('data-spline', '1');
      document.head.appendChild(s);
    }
  }, []);

  return (
    <div className="intro-page">

      {/* ── ROBOT: full-page background ── */}
      <div className="intro-robot-bg">
        {React.createElement('spline-viewer', {
          url: 'https://prod.spline.design/74ia6w-jnUFraMNt/scene.splinecode',
          'hide-ui': true,
          'events-target': 'local',
          style: { width: '100%', height: '100%' },
        })}
      </div>

      {/* Dark overlay so text stays readable over the white robot bg */}
      <div className="intro-overlay" />

      {/* Subtle grid on top */}
      <div className="intro-grid" aria-hidden />

      {/* ── CONTENT: centered over the robot ── */}
      <div className="intro-content">

        <div className="intro-badge anim-fadein" style={{animationDelay:'0.1s'}}>
          <span className="intro-badge-dot" />
          AUTONOMOUS PERCEPTION ENGINE v2.4
        </div>

        <h1 className="intro-title anim-fadein" style={{animationDelay:'0.25s'}}>
          <span className="intro-title-main">PERCEPT</span>
          <span className="intro-title-sub">Real-time Object Detection & Traffic Analysis</span>
        </h1>

        <p className="intro-desc anim-fadein" style={{animationDelay:'0.4s'}}>
          Upload dashcam or traffic footage and let YOLOv8 detect every vehicle,
          pedestrian, and object in real time — with live backend preview,
          traffic flow analysis, and speed estimation.
        </p>

        <div className="intro-features anim-fadein" style={{animationDelay:'0.55s'}}>
          {[
            {icon:'⚡', label:'Real-time Detection'},
            {icon:'📊', label:'Traffic Flow Analysis'},
            {icon:'🚗', label:'Speed Estimation'},
            {icon:'👁', label:'Live Backend Preview'},
          ].map(({icon,label}) => (
            <div key={label} className="intro-feature">
              <span className="intro-feature-icon">{icon}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>

        <button
          className={`intro-cta anim-fadein ${hovered ? 'intro-cta--hovered' : ''}`}
          style={{animationDelay:'0.7s'}}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={onEnter}
        >
          <span>Launch Dashboard</span>
          <span className="intro-cta-arrow">→</span>
        </button>

        <p className="intro-stack anim-fadein" style={{animationDelay:'0.85s'}}>
          Powered by &nbsp;YOLOv8 · OpenCV · Flask · React · ByteTrack
        </p>
      </div>
    </div>
  );
}

// ── MAIN APP ─────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]                   = useState('intro');
  const [settings, setSettings]           = useState(defaultSettings);
  const [selectedFile, setSelectedFile]   = useState(null);
  const [previewUrl, setPreviewUrl]       = useState(null);
  const [isProcessing, setIsProcessing]   = useState(false);
  const [progress, setProgress]           = useState(0);
  const [frameCount, setFrameCount]       = useState(0);
  const [totalFrames, setTotalFrames]     = useState(0);
  const [liveJpeg, setLiveJpeg]           = useState(null);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [videoHistory, setVideoHistory]   = useState([]);
  const [currentResult, setCurrentResult] = useState(null);
  const [historyModal, setHistoryModal]   = useState(null);
  const [dragOver, setDragOver]           = useState(false);
  const [demoMode, setDemoMode]           = useState(false);
  const [logLines, setLogLines]           = useState([
    'SYSTEM BOOT COMPLETE','YOLOv8n WEIGHTS LOADED',
    'FLASK SERVER CONNECTED','AWAITING VIDEO INPUT...',
  ]);

  const fileInputRef = useRef(null);
  const sseRef       = useRef(null);
  const demoCancelRef = useRef(null);

  // Apply initial settings on mount
  useEffect(() => { applySettings(settings); }, []);

  const addLog = useCallback((line) => {
    setLogLines(prev => [...prev.slice(-9), line]);
  }, []);

  const loadFile = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setCurrentResult(null);
    addLog(`LOADED  ${file.name}`);
    addLog(`SIZE    ${(file.size/1024/1024).toFixed(2)} MB`);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('video/')) loadFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsProcessing(true); setProgress(0); setFrameCount(0); setTotalFrames(0); setLiveJpeg(null);
    addLog('CHECKING SERVER CONNECTION...');

    // ── Step 0: health check — fall back to demo mode if unreachable ──
    let useDemo = false;
    try {
      const ping = await fetch(`${settings.backendUrl}/health`, { signal: AbortSignal.timeout(4000) });
      if (!ping.ok) throw new Error('Server returned error');
      const h = await ping.json();
      addLog(`SERVER OK  device=${h.device}  tracker=${h.tracker ? 'ByteTrack' : 'predict'}`);
    } catch (e) {
      useDemo = true;
      setDemoMode(true);
      addLog('BACKEND OFFLINE — ENTERING DEMO MODE');
      addLog('SIMULATING YOLOv8n DETECTION...');
    }

    if (useDemo) {
      // ── Demo simulation path ────────────────────────────────────────
      const savedName = selectedFile.name;
      const savedPreview = previewUrl;
      const savedFile = selectedFile;
      demoCancelRef.current = runDemoSimulation({
        file: savedFile,
        onProgress: (pct) => setProgress(pct),
        onFrame: (frame, total) => { setFrameCount(frame); setTotalFrames(total); },
        onComplete: (stats) => {
          setProgress(100);
          const analysis = { ...stats, filename: savedName, processedAt: new Date().toLocaleString() };
          // Use original video as the "annotated" output in demo mode
          const videoUrl = savedPreview;
          const newItem = { id: Date.now(), name: savedName, url: videoUrl, analysis, demo: true };
          setCurrentResult({ url: videoUrl, analysis, demo: true });
          setVideoHistory(prev => [newItem, ...prev]);
          addLog('DEMO DETECTION COMPLETE');
          addLog(`CARS: ${analysis.cars}  PEDS: ${analysis.pedestrians}`);
          addLog(`TRAFFIC: ${analysis.traffic_status}  FLOW: ${analysis.vehicles_per_minute}/min`);
          setSelectedFile(null); setPreviewUrl(null); setShowLivePreview(false);
          setIsProcessing(false);
        },
      });
      return;
    }

    // ── Real backend path ─────────────────────────────────────────────
    addLog('UPLOADING VIDEO...');
    const formData = new FormData();
    formData.append('video', selectedFile);
    const savedName    = selectedFile.name;
    const savedPreview = previewUrl;

    try {
      const startRes = await fetch(`${settings.backendUrl}/start-job`, { method:'POST', body:formData });
      if (!startRes.ok) { const e = await startRes.json(); throw new Error(e.error||'Failed to start job'); }
      const { job_id } = await startRes.json();
      addLog(`JOB STARTED  ID: ${job_id}`);

      await new Promise((resolve, reject) => {
        const es = new EventSource(`${settings.backendUrl}/stream/${job_id}`);
        sseRef.current = es;
        es.onmessage = (e) => {
          const data = JSON.parse(e.data);
          if (data.error) { es.close(); reject(new Error(data.error)); return; }
          const tf  = data.total_frames||1;
          const fc  = data.frame||0;
          setTotalFrames(tf); setFrameCount(fc);
          setProgress(Math.min((fc/tf)*100, 99));
          if (data.preview_jpeg) setLiveJpeg(data.preview_jpeg);
          if (data.done) {
            setProgress(100); es.close();
            const byteChars=atob(data.video_b64); const byteArrays=[];
            for(let i=0;i<byteChars.length;i+=512){
              const slice=byteChars.slice(i,i+512); const bytes=new Uint8Array(slice.length);
              for(let j=0;j<slice.length;j++) bytes[j]=slice.charCodeAt(j);
              byteArrays.push(bytes);
            }
            const videoUrl=URL.createObjectURL(new Blob(byteArrays,{type:'video/mp4'}));
            const analysis={...data.stats,filename:savedName,processedAt:new Date().toLocaleString()};
            const newItem={id:Date.now(),name:savedName,url:videoUrl,analysis};
            setCurrentResult({url:videoUrl,analysis});
            setVideoHistory(prev=>[newItem,...prev]);
            addLog('DETECTION COMPLETE');
            addLog(`CARS: ${analysis.cars}  PEDS: ${analysis.pedestrians}`);
            addLog(`TRAFFIC: ${analysis.traffic_status}  FLOW: ${analysis.vehicles_per_minute}/min`);
            setSelectedFile(null); setPreviewUrl(null); setShowLivePreview(false);
            resolve();
          }
        };
        es.onerror = () => { es.close(); reject(new Error('SSE connection lost')); };
      });
    } catch(err) {
      addLog(`ERROR  ${err.message}`); alert(err.message); setPreviewUrl(savedPreview);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => { return () => { sseRef.current?.close(); demoCancelRef.current?.(); }; }, []);

  const now=new Date();
  const timeStr=now.toTimeString().slice(0,8);
  const dateStr=now.toLocaleDateString('en-GB').replace(/\//g,'.');

  // ── INTRO PAGE ──────────────────────────────────────────────────
  if (page === 'intro') {
    return <IntroPage onEnter={() => setPage('detection')} />;
  }

  // ── MAIN DASHBOARD ──────────────────────────────────────────────
  return (
    <div className="root">
      <div className="bg-grid" aria-hidden />

      <header className="topbar">
        <div className="topbar-brand">
          <RadarRing active={isProcessing} />
          <span className="brand-name" style={{cursor:'pointer'}} onClick={() => setPage('intro')}>PERCEPT</span>
          <span className="brand-ver">v2.4</span>
        </div>
        <nav className="topbar-nav">
          {['detection','history','settings'].map(p => (
            <button key={p} className={`nav-item ${page===p?'nav-item--active':''}`} onClick={() => setPage(p)}>
              {p==='detection' ? '⬡ DETECTION' : p==='history' ? ('◷ HISTORY' + (videoHistory.length > 0 ? ' (' + videoHistory.length + ')' : '')) : '⚙ SETTINGS'}
            </button>
          ))}
        </nav>
        <div className="topbar-meta">
          <span className="meta-clock">{dateStr} · {timeStr}</span>
          <span className={`meta-status ${isProcessing?'meta-status--busy':''}`}>
            {isProcessing?`⬤ PROCESSING ${Math.round(progress)}%`:demoMode?'⬤ DEMO MODE':'⬤ READY'}
          </span>
        </div>
      </header>

      {/* DETECTION */}
      {page === 'detection' && (
        <main className="layout">
          {!settings.sidebarCollapsed && (
            <aside className="sidebar anim-fadein">
              <div className="card">
                <p className="card-title">DETECTION CLASSES</p>
                <ul className="class-list">
                  {[{label:'Person',color:'#a78bfa'},{label:'Car',color:'#34d399'},{label:'Bicycle',color:'#60a5fa'},{label:'Truck',color:'#f59e0b'},{label:'Bus',color:'#f87171'},{label:'Motorcycle',color:'#fb923c'},{label:'Traffic Light',color:'#facc15'},{label:'Animal',color:'#e879f9'}].map(({label,color}) => (
                    <li key={label} className="class-row">
                      <span className="class-pip" style={{background:color}} />
                      <span className="class-label">{label.toUpperCase()}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card card--log">
                <p className="card-title">ACTIVITY LOG</p>
                <div className="log-body">
                  {logLines.map((l,i) => (
                    <div key={i} className="log-row"><span className="log-tick">{String(i).padStart(2,'0')}</span><span className="log-text">{l}</span></div>
                  ))}
                  <div className="log-row"><span className="log-tick">__</span><span className="log-cursor">▋</span></div>
                </div>
              </div>
              <div className="card">
                <p className="card-title">SESSION</p>
                <div className="kv-table">
                  <span className="kv-k">PROCESSED</span><span className="kv-v">{videoHistory.length}</span>
                  <span className="kv-k">MODEL</span><span className="kv-v">YOLOv8n</span>
                  <span className="kv-k">CONF</span><span className="kv-v">{settings.detectionConf}%</span>
                </div>
              </div>
            </aside>
          )}

          <section className="feed-col">
            <div className="feed-card">
              <div className="feed-header">
                <span className="feed-title">LIVE FEED</span>
                {isProcessing && (
                  <span className="feed-proc-badge">
                    <span className="proc-dot" />
                    FRAME {frameCount.toLocaleString()} / {totalFrames.toLocaleString()} · {Math.round(progress)}%
                  </span>
                )}
              </div>
              <input type="file" accept="video/mp4,video/*" onChange={e=>loadFile(e.target.files[0])} ref={fileInputRef} style={{display:'none'}} />
              {!previewUrl && !currentResult && (
                <div className={`dropzone ${dragOver?'dropzone--over':''}`}
                  onClick={()=>fileInputRef.current.click()}
                  onDragOver={e=>{e.preventDefault();setDragOver(true);}}
                  onDragLeave={()=>setDragOver(false)} onDrop={handleDrop}>
                  <div className="dz-content">
                    <div className="dz-icon-wrap">
                      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                        <path d="M15 10l4.553-2.07A1 1 0 0121 8.845v6.31a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
                      </svg>
                    </div>
                    <p className="dz-headline">DROP VIDEO HERE</p>
                    <p className="dz-sub">or click to browse · MP4 · MOV · AVI · MKV</p>
                  </div>
                </div>
              )}
              {previewUrl && (
                <div className="preview-wrap">
                  <video src={previewUrl} autoPlay loop muted className="preview-video" />
                  {isProcessing && <ProcessingOverlay progress={progress} frameCount={frameCount} totalFrames={totalFrames} style={settings.progressStyle} />}
                </div>
              )}
              {currentResult && !isProcessing && <AnalysisPanel analysis={currentResult.analysis} videoUrl={currentResult.url} demo={currentResult.demo} />}
              <div className="feed-actions">
                <button className="btn btn-ghost" onClick={()=>{fileInputRef.current.click();setCurrentResult(null);}} disabled={isProcessing}>
                  {currentResult?'⟳  Process Another':'⟳  Change Video'}
                </button>
                {isProcessing && (
                  <button className="btn btn-live" onClick={()=>setShowLivePreview(true)}>👁 View Backend Live</button>
                )}
                {!currentResult && (
                  <button className="btn btn-primary" onClick={handleUpload} disabled={!selectedFile||isProcessing}>
                    {isProcessing?<><span className="spinner"/>&nbsp;Processing… {Math.round(progress)}%</>:'▶  Run Detection'}
                  </button>
                )}
              </div>
              {isProcessing && (
                <div className="inline-progress"><div className="inline-progress-fill" style={{width:`${progress}%`}}/></div>
              )}
            </div>
          </section>

          <aside className="gallery-col">
            <div className="card card--gallery">
              <p className="card-title">RECENT {videoHistory.length>0&&<span className="count-badge">{videoHistory.length}</span>}</p>
              {videoHistory.length===0
                ? <div className="gallery-empty"><p>No videos yet.</p><p>Processed output appears here.</p></div>
                : <div className="gallery-list">{videoHistory.slice(0,5).map(vid=>(
                    <div key={vid.id} className="gitem" onClick={()=>setHistoryModal(vid)}>
                      <div className="gitem-thumb">
                        <video src={vid.url} muted autoPlay loop className="gitem-video"/>
                        <div className="gitem-hover"><span className="gitem-play">⛶ VIEW</span></div>
                      </div>
                      <div className="gitem-meta"><span className="gitem-dot"/><span className="gitem-name">{vid.name}</span></div>
                    </div>
                  ))}</div>
              }
            </div>
          </aside>
        </main>
      )}

      {/* HISTORY */}
      {page === 'history' && (
        <main className="history-page anim-fadein">
          <div className="history-header">
            <span className="history-title">PROCESSED FOOTAGE LIBRARY</span>
            <span className="history-count">{videoHistory.length} VIDEO{videoHistory.length!==1?'S':''}</span>
          </div>
          {videoHistory.length===0
            ? <div className="history-empty"><div className="history-empty-icon">◷</div><p>No processed videos yet.</p><button className="btn btn-primary" style={{marginTop:16}} onClick={()=>setPage('detection')}>▶ Go to Detection</button></div>
            : <div className="history-grid">{videoHistory.map(vid=>(
                <div key={vid.id} className="hcard anim-fadein" onClick={()=>setHistoryModal(vid)}>
                  <div className="hcard-thumb"><video src={vid.url} muted autoPlay loop className="hcard-video"/><div className="hcard-overlay"><span className="hcard-play">⛶ VIEW FULL REPORT</span></div></div>
                  <div className="hcard-body">
                    <p className="hcard-name">{vid.name}</p>
                    <p className="hcard-date">{vid.analysis.processedAt}</p>
                    <div className="hcard-stats">
                      <span>🚗 {vid.analysis.cars}</span><span>🚶 {vid.analysis.pedestrians}</span><span>🚛 {vid.analysis.trucks}</span>
                      <span style={{color:vid.analysis.traffic_density==='HIGH'?'#f87171':vid.analysis.traffic_density==='MODERATE'?'#f59e0b':'#34d399'}}>● {vid.analysis.traffic_status}</span>
                    </div>
                  </div>
                </div>
              ))}</div>
          }
        </main>
      )}

      {/* SETTINGS */}
      {page === 'settings' && <SettingsPage settings={settings} setSettings={setSettings} />}

      <footer className="footer">
        <span>PERCEPT ENGINE · ACTIVE</span>
        <span>OpenCV · YOLOv8 · Flask · React</span>
        <span>© 2025 PERCEPT SYSTEMS</span>
      </footer>

      {showLivePreview&&isProcessing&&<LivePreviewModal jpegB64={liveJpeg} frame={frameCount} totalFrames={totalFrames} onClose={()=>setShowLivePreview(false)}/>}
      {historyModal&&<HistoryModal item={historyModal} onClose={()=>setHistoryModal(null)}/>}
    </div>
  );
}