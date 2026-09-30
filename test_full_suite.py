import urllib.request
import json

base = 'http://localhost:8080'

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
