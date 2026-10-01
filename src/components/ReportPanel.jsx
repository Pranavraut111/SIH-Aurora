import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  LuFileText, LuPrinter, LuDownload, LuShare2, LuCalendar,
  LuShieldCheck, LuTriangleAlert, LuThermometerSnowflake, LuZap,
  LuPackage, LuRadioTower, LuSparkles, LuCheck, LuInfo, LuMapPin
} from 'react-icons/lu';
import './ReportPanel.css';
import { apiGet } from '../services/api';

// Each source fails independently; a failed source is reported in the
// document as unavailable — never replaced with made-up numbers.
function settle(promise, label) {
  return promise.then(
    (data) => ({ data, error: null }),
    (err) => {
      console.error(`[Report] ${label} failed`, err);
      return { data: null, error: err?.kind === 'http' ? `HTTP ${err.status}` : 'backend unreachable' };
    },
  );
}
const PROV_STATUS = {
  REAL: { cls: 'ok', text: 'REAL (NCPOR AWS)' },
  REANALYSIS: { cls: 'model', text: 'REANALYSIS (ERA5)' },
  'HARDCODED-DEMO': { cls: 'model', text: 'HARDCODED DEMO (no observations in DB)' },
};
const v = (x, unit = '') => (x == null ? '—' : `${x}${unit}`);


export default function ReportPanel({ activeStation = 'maitri', sensorData = {} }) {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState('24h');
  const [selectedStation, setSelectedStation] = useState(activeStation);
  const [includeSim, setIncludeSim] = useState(true);
  const [printTimestamp, setPrintTimestamp] = useState(new Date().toUTCString());
  const reportRef = useRef(null);

  // Sync selected station with props if changed externally
  useEffect(() => {
    setSelectedStation(activeStation);
  }, [activeStation]);

  // Fetch full report data from backend
  const fetchReportData = async () => {
    setLoading(true);
    try {
      const [weatherRes, riskRes, logisticsRes, alertsRes, configRes] = await Promise.all([
        settle(apiGet(`/ncpor/live?stationId=${selectedStation}`), 'weather'),
        settle(apiGet(`/risk?stationId=${selectedStation}`), 'risk'),
        settle(apiGet(`/logistics?stationId=${selectedStation}`), 'logistics'),
        settle(apiGet(`/alerts?stationId=${selectedStation}`), 'alerts'),
        settle(apiGet('/admin/config'), 'config'),
      ]);

      setReportData({
        stationId: selectedStation,
        stationName: selectedStation === 'maitri' ? 'Maitri Antarctic Research Station' : 'Bharati Antarctic Research Station',
        location: selectedStation === 'maitri' ? '70°46′S, 11°44′E (Schirmacher Oasis, Dronning Maud Land)' : '69°24′S, 76°12′E (Larsemann Hills, Prydz Bay)',
        elevation: selectedStation === 'maitri' ? '117m MSL' : '35m MSL',
        weather: weatherRes.data?.weather || null,
        risk: riskRes.data || null,
        logistics: logisticsRes.data?.items || null,
        alerts: alertsRes.data?.activeAlerts || [],
        config: configRes.data || {},
        errors: {
          weather: weatherRes.error, risk: riskRes.error, logistics: logisticsRes.error,
          alerts: alertsRes.error, config: configRes.error,
        },
        generatedAt: new Date().toISOString(),
        sensors: sensorData || {}
      });
    } catch (e) {
      console.error('Report data fetch error:', e);
    } finally {
      setLoading(false);
      setPrintTimestamp(new Date().toUTCString());
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [selectedStation, selectedPeriod]);

  // Print / Save to PDF
  const handlePrint = () => {
    window.print();
  };

  // Download JSON Report
  const handleDownloadJSON = () => {
    if (!reportData) return;
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Aurora_${selectedStation.toUpperCase()}_Operations_Report_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const w = reportData?.weather;
  const weatherProv = w ? `${w.provenance} — ${w.dataset || 'no dataset'} (${w.source})` : 'unavailable';
  const wStatus = PROV_STATUS[w?.provenance] || { cls: 'model', text: 'UNKNOWN' };
  const gen = reportData?.sensors?.generator || {};
  const lq = reportData?.sensors?.livingQuarters || {};
  const specificFuel = gen.gen_fuel_rate && gen.gen_power ? (gen.gen_fuel_rate / gen.gen_power).toFixed(3) : null;

  // Download CSV Metrics Summary
  const handleDownloadCSV = () => {
    if (!reportData) return;
    const rows = [
      ['Metric', 'Value', 'Unit', 'Source / Provenance'],
      ['Station Name', reportData.stationName, '', 'public station info'],
      ['Coordinates', reportData.location, '', 'public station info'],
      ['Ambient Temperature', w?.temperature_c ?? '', '°C', weatherProv],
      ['Wind Speed', w?.wind_speed_kmh ?? '', 'km/h', weatherProv],
      ['Air Pressure', w?.air_pressure_hpa ?? '', 'hPa', weatherProv],
      ['Relative Humidity', w?.relative_humidity_pct ?? '', '%', weatherProv],
      ['Calculated Wind Chill', reportData.risk?.wind_chill_c ?? '', '°C', 'MODEL-DERIVED (wind chill formula)'],
      ['Overall Risk Score', reportData.risk ? `${reportData.risk.risk_score}/100` : '', '', 'MODEL-DERIVED (rule-based risk score)'],
      ['Generator Power', gen.gen_power ?? '', 'kW', 'MODEL-DERIVED'],
      ['Generator Fuel Rate', gen.gen_fuel_rate ?? '', 'L/hr', 'MODEL-DERIVED'],
    ];

    if (reportData.logistics) {
      reportData.logistics.forEach(item => {
        rows.push([item.name, item.current, item.unit, `${item.daysRemaining} Days Remaining (${item.provenance})`]);
      });
    }

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.map(cell => `"${cell}"`).join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Aurora_${selectedStation.toUpperCase()}_Metrics_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <motion.div
      className="report-panel-wrapper"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.25 }}
    >
      {/* Action Toolbar (Hidden during Print) */}
      <div className="report-toolbar glass-panel no-print">
        <div className="toolbar-left">
          <div className="toolbar-title-wrap">
            <LuFileText size={20} className="toolbar-icon" />
            <h2 className="toolbar-title font-display">Station Operations Report Generator</h2>
          </div>
          <p className="toolbar-desc text-caption">
            Status brief from the stored weather observations (labelled REAL / REANALYSIS) and model-derived telemetry. Prototype — not an official document.
          </p>
        </div>

        <div className="toolbar-controls">
          <div className="station-select-wrap">
            <label className="text-caption">Target Station:</label>
            <select
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className="report-select"
            >
              <option value="maitri">Maitri Station (Schirmacher Oasis)</option>
              <option value="bharati">Bharati Station (Larsemann Hills)</option>
            </select>
          </div>

          <div className="action-btn-group">
            <button className="btn-action primary" onClick={handlePrint}>
              <LuPrinter size={16} /> Print / Save as PDF
            </button>
            <button className="btn-action secondary" onClick={handleDownloadCSV}>
              <LuDownload size={15} /> Export CSV
            </button>
            <button className="btn-action secondary" onClick={handleDownloadJSON}>
              <LuShare2 size={15} /> Export JSON
            </button>
          </div>
        </div>
      </div>

      {/* Printable Report Document Container */}
      <div className="report-document glass-panel" ref={reportRef}>
        {/* Report Header */}
        <div className="report-doc-header">
          <div className="report-emblem-row">
            <div className="gov-badge">
              <span className="gov-title">AURORA DIGITAL TWIN — PROTOTYPE</span>
              <span className="ministry-title">NOT AN OFFICIAL NCPOR / MoES DOCUMENT</span>
              <span className="ncpor-title">Generated by the Aurora demo for SIH PS 26060</span>
            </div>
            <div className="report-meta-box">
              <span className="doc-num font-mono">REPORT: AURORA/{selectedStation.toUpperCase()}/{new Date().toISOString().slice(0, 10)}</span>
              <span className="doc-date font-mono">GENERATED: {printTimestamp}</span>
            </div>
          </div>

          <div className="report-subject-banner">
            <h1 className="report-main-title font-display">
              STATION STATUS REPORT
            </h1>
            <h3 className="report-sub-title">
              WEATHER OBSERVATIONS & MODEL-DERIVED OPERATIONS SUMMARY
            </h3>
          </div>
        </div>

        {loading ? (
          <div className="report-loading">
            <LuSparkles size={24} className="spin" />
            <span>Compiling report from the Aurora backend…</span>
          </div>
        ) : (
          <div className="report-doc-body">
            {Object.entries(reportData.errors || {}).filter(([, e]) => e).length > 0 && (
              <p className="section-note text-caption" role="status" style={{ color: '#f87171' }}>
                Unavailable sources: {Object.entries(reportData.errors).filter(([, e]) => e).map(([k, e]) => `${k} (${e})`).join(', ')}.
              </p>
            )}
            {/* Section 1: Station Overview */}
            <div className="report-section">
              <h4 className="section-heading font-display">
                1. STATION OVERVIEW & LOCATION SPECIFICATIONS
              </h4>
              <div className="overview-grid">
                <div className="ov-item">
                  <span className="ov-lbl">Facility:</span>
                  <span className="ov-val font-semibold">{reportData.stationName}</span>
                </div>
                <div className="ov-item">
                  <span className="ov-lbl">Geographic Locus:</span>
                  <span className="ov-val">{reportData.location}</span>
                </div>
                <div className="ov-item">
                  <span className="ov-lbl">Elevation / Terrain:</span>
                  <span className="ov-val">{reportData.elevation}</span>
                </div>
                <div className="ov-item">
                  <span className="ov-lbl">Operational Status:</span>
                  <span className={`ov-val status-badge-inline ${reportData.alerts.length ? 'warn' : 'ok'}`}>
                    {reportData.errors?.alerts ? 'Unknown (alerts unavailable)' : reportData.alerts.length ? `${reportData.alerts.length} active alert(s)` : 'No active alerts'}
                  </span>
                </div>
                <div className="ov-item">
                  <span className="ov-lbl">Wintering Personnel:</span>
                  <span className="ov-val">{selectedStation === 'maitri' ? '25' : '47'} (HARDCODED-DEMO figure)</span>
                </div>
                <div className="ov-item">
                  <span className="ov-lbl">Primary Telemetry Feed:</span>
                  <span className="ov-val font-mono">{weatherProv}</span>
                </div>
              </div>
            </div>

            {/* Section 2: Real Atmospheric Observations */}
            <div className="report-section">
              <h4 className="section-heading font-display">
                2. LATEST STORED WEATHER OBSERVATION
              </h4>
              <p className="section-note text-caption">
                {!w ? `Weather unavailable (${reportData.errors?.weather || 'no data'}).`
                  : w.provenance === 'REAL' ? 'Latest NCPOR AWS observation ingested from https://data.ncpor.res.in.'
                    : w.provenance === 'REANALYSIS' ? 'Latest ERA5 reanalysis value (model reanalysis, not a station measurement). Ingest NCPOR data to get station observations.'
                      : 'No observations in the database — built-in default values.'}
              </p>

              <table className="report-table">
                <thead>
                  <tr>
                    <th>Observation Parameter</th>
                    <th>Observed Value</th>
                    <th>Unit</th>
                    <th>Sensor / Station Source</th>
                    <th>Quality Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Surface Air Temperature</strong></td>
                    <td className="font-mono tabular-nums font-semibold">{v(w?.temperature_c, '°C')}</td>
                    <td>Celsius</td>
                    <td>{w?.source || '—'}</td>
                    <td><span className={`tbl-status ${wStatus.cls}`}>{wStatus.text}</span></td>
                  </tr>
                  <tr>
                    <td><strong>Sustained Wind Speed</strong></td>
                    <td className="font-mono tabular-nums font-semibold">{v(w?.wind_speed_kmh, ' km/h')} ({v(w?.wind_speed_ms, ' m/s')})</td>
                    <td>km/h</td>
                    <td>{w?.source || '—'}</td>
                    <td><span className={`tbl-status ${wStatus.cls}`}>{wStatus.text}</span></td>
                  </tr>
                  <tr>
                    <td><strong>Barometric Air Pressure</strong></td>
                    <td className="font-mono tabular-nums font-semibold">{v(w?.air_pressure_hpa, ' hPa')}</td>
                    <td>hPa</td>
                    <td>{w?.source || '—'}</td>
                    <td><span className={`tbl-status ${wStatus.cls}`}>{wStatus.text}</span></td>
                  </tr>
                  <tr>
                    <td><strong>Relative Humidity</strong></td>
                    <td className="font-mono tabular-nums font-semibold">{v(w?.relative_humidity_pct, '%')}</td>
                    <td>%</td>
                    <td>{w?.source || '—'}</td>
                    <td><span className={`tbl-status ${wStatus.cls}`}>{wStatus.text}</span></td>
                  </tr>
                  <tr>
                    <td><strong>Calculated Wind Chill (Siple-Passel / Jaggar)</strong></td>
                    <td className="font-mono tabular-nums font-semibold" style={{ color: '#38bdf8' }}>{v(reportData.risk?.wind_chill_c, '°C')}</td>
                    <td>°C</td>
                    <td>Wind chill formula on the values above</td>
                    <td><span className="tbl-status model">MODEL-DERIVED</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Section 3: Energy Grid & Power Generation */}
            <div className="report-section">
              <h4 className="section-heading font-display">
                3. ELECTRICAL POWER GRID & THERMAL HEATING STATUS
              </h4>
              <div className="power-grid-summary">
                <div className="p-card">
                  <span className="p-title">Generator Output</span>
                  <span className="p-val font-mono">{v(gen.gen_power, ' kW')}</span>
                  <span className="p-sub">MODEL-DERIVED (live telemetry)</span>
                </div>
                <div className="p-card">
                  <span className="p-title">Active Diesel Burn Rate</span>
                  <span className="p-val font-mono">
                    {v(gen.gen_fuel_rate, ' L/hr')}
                  </span>
                  <span className="p-sub">Specific: {specificFuel ? `${specificFuel} L/kWh` : '—'}</span>
                </div>
                <div className="p-card">
                  <span className="p-title">Generator Coolant Temp</span>
                  <span className="p-val font-mono">
                    {v(gen.gen_temp, '°C')}
                  </span>
                  <span className="p-sub">Warning threshold: {v(reportData.config?.thresholds?.generator_temp_warning, '°C')}</span>
                </div>
                <div className="p-card">
                  <span className="p-title">Living Block Indoor Temp</span>
                  <span className="p-val font-mono">
                    {v(lq.lq_temp, '°C')}
                  </span>
                  <span className="p-sub">MODEL-DERIVED</span>
                </div>
              </div>
            </div>

            {/* Section 4: Polar Logistics & Autonomy */}
            <div className="report-section">
              <h4 className="section-heading font-display">
                4. LIFE-SUPPORT LOGISTICS & SUPPLY AUTONOMY
              </h4>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Inventory Commodity</th>
                    <th>Current On-Hand</th>
                    <th>Max Capacity</th>
                    <th>Daily Burn</th>
                    <th>Estimated Autonomy</th>
                    <th>Provenance / Entry Type</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.logistics && reportData.logistics.length > 0 ? (
                    reportData.logistics.map(item => (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong> ({item.category})</td>
                        <td className="font-mono tabular-nums font-semibold">{item.current} {item.unit}</td>
                        <td className="font-mono tabular-nums">{item.max} {item.unit}</td>
                        <td className="font-mono tabular-nums">{item.dailyUse} {item.unit}/day</td>
                        <td>
                          <span className={`autonomy-badge ${item.isLow ? 'low' : 'good'}`}>
                            {item.daysRemaining} Days ({item.isLow ? 'REORDER REQUIRED' : 'SUFFICIENT'})
                          </span>
                        </td>
                        <td className="text-caption font-mono">{item.provenance}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>Inventory unavailable ({reportData.errors?.logistics || 'no items'}).</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Section 5: Risk Engine & Operational Advisories */}
            <div className="report-section">
              <h4 className="section-heading font-display">
                5. RULE-BASED RISK ASSESSMENT
              </h4>
              {!reportData.risk ? (
                <p className="section-note text-caption">Risk engine unavailable ({reportData.errors?.risk || 'no data'}).</p>
              ) : (
              <div className="risk-advisory-box">
                <div className="risk-header-line">
                  <span className="risk-score-display">
                    Calculated Station Risk Index: <strong>{reportData.risk.risk_score}/100</strong> ({reportData.risk.overall_health.toUpperCase()})
                  </span>
                </div>

                {reportData.risk.identified_risks && reportData.risk.identified_risks.length > 0 ? (
                  <div className="risk-cards-list">
                    {reportData.risk.identified_risks.map((r, i) => (
                      <div key={i} className={`risk-entry-card ${r.risk_level}`}>
                        <div className="risk-top">
                          <span className="risk-id font-mono">[{r.risk_id}]</span>
                          <span className="risk-sys">Target System: {r.affected_system}</span>
                          <span className="risk-sev badge">{r.risk_level.toUpperCase()}</span>
                        </div>
                        <p className="risk-reason"><strong>Observation:</strong> {r.reason}</p>
                        <p className="risk-act"><strong>Recommended Action:</strong> {r.recommended_action}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="risk-nominal">
                    <LuShieldCheck size={18} style={{ color: '#4ade80' }} />
                    No weather/operations risks identified by the rule-based risk score.
                  </p>
                )}
              </div>
              )}
            </div>

            {/* Section 6: Review & Sign-Off */}
            <div className="report-section signoff-section">
              <h4 className="section-heading font-display">
                6. REVIEW & SIGN-OFF
              </h4>
              <div className="signoff-grid">
                <div className="sign-box">
                  <span className="sign-title">Prepared By:</span>
                  <span className="sign-name">Aurora digital twin (prototype, auto-generated)</span>
                  <span className="sign-role">Values labelled by provenance; not verified by NCPOR</span>
                </div>
                <div className="sign-box">
                  <span className="sign-title">Station Leader Endorsement:</span>
                  <span className="sign-name">Station Commander / Chief Wintering Officer</span>
                  <span className="sign-role">{reportData.stationName}</span>
                  <div className="sign-line">SIGNATURE & SEAL</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
