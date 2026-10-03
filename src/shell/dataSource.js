/* Aurora — where the numbers on screen come from, as one global status.
   `status` picks the status colour: live data is normal, degraded sources warn,
   browser-generated data is marked simulated so it cannot pass as real. */
export const DATA_SOURCES = {
  simulator: {
    label: 'Live simulator', status: 'normal',
    help: 'Telemetry from the simulator: the physics model driven by an ERA5 reanalysis replay.',
  },
  'physics-fallback': {
    label: 'Physics fallback', status: 'warning',
    help: 'The simulator is offline; the backend physics model is producing telemetry.',
  },
  'browser-demo': {
    label: 'Browser demo', status: 'simulated',
    help: 'Backend unreachable. Random-walk demo data generated in this browser. Not real.',
  },
  offline: {
    label: 'Link down (simulated)', status: 'offline',
    help: 'Simulated satellite link loss: the station keeps recording on site; this dashboard shows the last data received until the link returns.',
  },
  connecting: {
    label: 'Connecting…', status: 'offline',
    help: 'Waiting for the first telemetry message.',
  },
};

export function dataSourceInfo(source) {
  return DATA_SOURCES[source] || DATA_SOURCES.connecting;
}
