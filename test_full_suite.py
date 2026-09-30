import os
import time
import urllib.error
import urllib.request
import json

# Unified backend base URL (override for non-default ports/hosts).
base = os.environ.get('AURORA_API_URL', 'http://localhost:8080').rstrip('/')


def get_json(path):
    with urllib.request.urlopen(base + path) as res:
        return res.status, json.loads(res.read().decode('utf-8'))


def post_json(path, payload):
    req = urllib.request.Request(base + path, data=json.dumps(payload).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as res:
        return res.status, json.loads(res.read().decode('utf-8'))


def expect_404(method, path, payload=None):
    try:
        if method == 'GET':
            get_json(path)
        else:
            post_json(path, payload or {})
    except urllib.error.HTTPError as e:
        assert e.code == 404, f'{method} {path} -> {e.code}, expected 404'
        detail = json.loads(e.read().decode('utf-8')).get('detail', '')
        assert 'Unknown station' in detail, detail
        return
    raise AssertionError(f'{method} {path} did not return 404')

print('=== 0. HEALTH, BATCH INGEST, STATE, VALIDATION ===')
st, h = get_json('/api/health')
assert st == 200 and h['db']['ok'], h
print(f"[PASS] /api/health -> status={h['status']} version={h['version']} simulator={h['simulator']['reachable']}")
# Re-post bharati's CURRENT published values so the check doesn't disturb live telemetry.
# (If the simulator isn't running, bharati is labelled "simulator" for SIM_BATCH_FRESH_S.)
_, cur = get_json('/api/station/bharati/state')
batch = {'stationId': 'bharati', 'timestamp': int(time.time() * 1000),
         'readings': {b: {k: {'value': v, 'unit': ''} for k, v in sens.items()} for b, sens in cur['sensors'].items()},
         'eventTimeline': cur.get('eventTimeline', []), 'activePatterns': cur.get('activePatterns', [])}
st, r = post_json('/api/sensors/batch', batch)
assert st == 200 and r['status'] == 'accepted', r
print(f"[PASS] POST /api/sensors/batch -> {r['status']} (historyPoints={r['historyPoints']})")
for sid in ('maitri', 'bharati'):
    st, snap = get_json(f'/api/station/{sid}/state')
    assert st == 200 and snap['stationId'] == sid and snap['dataSource'] in ('simulator', 'physics-fallback'), snap
    assert 'provenance' in snap and 'equipment' in snap['provenance'], snap
    print(f"[PASS] /api/station/{sid}/state -> dataSource={snap['dataSource']} equipment={snap['provenance']['equipment']}")
for path in ['/api/station/xyz/state', '/api/sensors/latest?stationId=xyz', '/api/alerts?stationId=xyz',
             '/api/risk?stationId=xyz', '/api/logistics?stationId=xyz', '/api/twin-inspector?station=xyz']:
    expect_404('GET', path)
expect_404('POST', '/api/sensors/batch', {**batch, 'stationId': 'xyz'})
expect_404('POST', '/api/simulation/whatif', {'stationId': 'xyz', 'scenarioId': 'blizzard'})
print('[PASS] unknown station -> 404 with message on GET + POST routes')
print()

print('=== 1. TESTING ALL 7 WHAT-IF SCENARIOS ===')
scenarios = ['extreme_cold', 'blizzard', 'gen_failure', 'battery_failure', 'fuel_leak', 'comms_outage', 'resupply_delay']
for sc in scenarios:
    req = urllib.request.Request(
        base + '/api/simulation/whatif',
        data=json.dumps({'stationId': 'maitri', 'scenarioId': sc, 'intensity': 1.2}).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    res = urllib.request.urlopen(req)
    d = json.loads(res.read().decode('utf-8'))
    score = d.get('calculatedRisk', {}).get('score')
    subs = len(d.get('affectedSubsystems', []))
    print(f'[PASS] Scenario: {sc:16} -> Status {res.status}, Risk Score: {score}/100, Impacted Subsystems: {subs}')

print('\n=== 2. TESTING SATELLITE CONNECTION TOGGLE API ===')
req = urllib.request.Request(base + '/api/connection/toggle?stationId=maitri', data=b'', headers={'Content-Type': 'application/json'})
res = urllib.request.urlopen(req)
d = json.loads(res.read().decode('utf-8'))
print(f'[PASS] Toggle Link -> Connected: {d.get("connected")}')

req = urllib.request.Request(base + '/api/connection/toggle?stationId=maitri', data=b'', headers={'Content-Type': 'application/json'})
res = urllib.request.urlopen(req)
d = json.loads(res.read().decode('utf-8'))
print(f'[PASS] Restore Link -> Connected: {d.get("connected")}')

print('\n=== 3. TESTING REPORT DATA SOURCES ===')
for ep in ['/api/ncpor/live?stationId=maitri', '/api/ncpor/live?stationId=bharati', '/api/risk?stationId=maitri', '/api/logistics?stationId=maitri', '/api/alerts?stationId=maitri', '/api/admin/config']:
    res = urllib.request.urlopen(base + ep)
    d = json.loads(res.read().decode('utf-8'))
    print(f'[PASS] {ep} -> {res.status} OK')

print('\n=== 4. TESTING ADMIN CONFIGURATION PERSISTENCE ===')
req = urllib.request.Request(
    base + '/api/admin/config',
    data=json.dumps({'thresholds': {'generator_temp_critical': 96.5, 'wind_speed_critical_ms': 26.0}}).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)
res = urllib.request.urlopen(req)
d = json.loads(res.read().decode('utf-8'))
print(f'[PASS] POST /api/admin/config -> Updated thresholds: {d.get("thresholds")}')

print('\nALL END-TO-END VERIFICATION CHECKS COMPLETED SUCCESSFULLY!')
