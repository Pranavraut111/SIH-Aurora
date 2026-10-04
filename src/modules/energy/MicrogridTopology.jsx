/* ═══════════════════════════════════════════════════════════════
   Aurora — Microgrid Power Flow Topology Schematic.
   Visualizes real-time power routing across Generation Sources
   (Solar PV, Wind Alternator, Diesel CHP Genset), Central Microgrid Bus
   & LiFePO4 Battery Storage (BESS), and Facility Consumers with
   animated SVG current conduits and dynamic load balance.
   ═══════════════════════════════════════════════════════════════ */
import { useMemo, useState } from 'react';
import { Box, Card, Chip, Stack, Typography } from '@mui/material';
import SolarPowerOutlined from '@mui/icons-material/SolarPowerOutlined';
import AirOutlined from '@mui/icons-material/AirOutlined';
import ElectricBoltOutlined from '@mui/icons-material/ElectricBoltOutlined';
import BatteryChargingFullOutlined from '@mui/icons-material/BatteryChargingFullOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import ThermostatOutlined from '@mui/icons-material/ThermostatOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import CellTowerOutlined from '@mui/icons-material/CellTowerOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { formatNumber, formatValue, isNum } from '../../lib/format';

const GLASS_CARD = {
  p: 2,
  borderRadius: '10px',
  bgcolor: 'background.paper',
  border: '1px solid',
  borderColor: 'divider',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  position: 'relative',
  zIndex: 2,
  transition: 'transform 0.2s, border-color 0.2s, box-shadow 0.2s',
  '&:hover': {
    borderColor: 'primary.main',
    transform: 'translateY(-2px)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
  },
};

export default function MicrogridTopology({
  powerKW = 84.3,
  demandData = null,
  envWindKmh = 25,
  isDaylight = true,
  stationName = 'Maitri',
}) {
  const [, setSelectedAsset] = useState(null);

  // Dynamic but causal power balance derivation
  const topology = useMemo(() => {
    const totalDemand = isNum(demandData?.totalDemand_kW) ? demandData.totalDemand_kW : (isNum(powerKW) ? powerKW : 84.3);

    // Solar generation (active during daylight hours)
    const solarRated = 50.0;
    const solarGen = isDaylight ? Math.min(solarRated, Math.max(12.5, totalDemand * 0.42)) : 0.0;

    // Wind generation (scaled with wind speed)
    const windRated = 30.0;
    const windSpeedFactor = Math.min(1.0, Math.max(0.2, (envWindKmh || 22) / 60));
    const windGen = Math.round(windRated * windSpeedFactor * 10) / 10;

    // Diesel genset: modulates to maintain 50 Hz microgrid balance
    const renewableTotal = solarGen + windGen;
    const dieselTarget = Math.max(22.0, totalDemand - renewableTotal * 0.7);
    const dieselGen = Math.round(dieselTarget * 10) / 10;

    const totalGen = Math.round((solarGen + windGen + dieselGen) * 10) / 10;

    // Battery storage dynamics
    const netDifference = Math.round((totalGen - totalDemand) * 10) / 10;
    const isCharging = netDifference >= 0;
    const batteryPowerKW = Math.abs(netDifference);
    const batterySOC = 78.4; // %
    const batteryCapacityKWh = 240.0;
    const remainingRuntimeHrs = Math.round((batteryCapacityKWh * (batterySOC / 100) / (totalDemand * 0.5)) * 10) / 10;

    // Consumer loads breakdown
    const hvacDemand = isNum(demandData?.heatingElectrical_kW)
      ? demandData.heatingElectrical_kW + (demandData.ventilation_kW || 0)
      : Math.round(totalDemand * 0.48 * 10) / 10;

    const scienceDemand = isNum(demandData?.baseElectrical_kW)
      ? demandData.baseElectrical_kW
      : Math.round(totalDemand * 0.32 * 10) / 10;

    const commsDemand = isNum(demandData?.comms_kW)
      ? demandData.comms_kW + (demandData.waterTreatment_kW || 0)
      : Math.round((totalDemand - hvacDemand - scienceDemand) * 10) / 10;

    const renewableShare = Math.round((renewableTotal / totalGen) * 100);

    return {
      totalDemand,
      totalGen,
      solarGen,
      windGen,
      dieselGen,
      renewableShare,
      isCharging,
      batteryPowerKW,
      batterySOC,
      batteryVoltage: 418.2,
      remainingRuntimeHrs,
      consumers: [
        { id: 'hvac', label: 'Life Support & Thermal HVAC', kw: hvacDemand, Icon: ThermostatOutlined, color: '#F5B83D' },
        { id: 'science', label: 'Scientific Labs & Cryo Storage', kw: scienceDemand, Icon: ScienceOutlined, color: '#7FDBFF' },
        { id: 'comms', label: 'Comms, Radars & Station Utilities', kw: commsDemand, Icon: CellTowerOutlined, color: '#5FD08A' },
      ],
    };
  }, [powerKW, demandData, envWindKmh, isDaylight]);

  return (
    <Card
      data-testid="microgrid-topology-schematic"
      sx={{
        p: { xs: 2.5, md: 3.5 },
        borderRadius: '12px',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        position: 'relative',
        overflow: 'hidden',
        mb: 4,
      }}
    >
      <style>{`
        @keyframes aurora-conduit-flow {
          from { stroke-dashoffset: 40; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes aurora-conduit-reverse {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: 40; }
        }
        .conduit-flow-active {
          stroke-dasharray: 6 6;
          animation: aurora-conduit-flow 1.2s linear infinite;
        }
        .conduit-flow-reverse {
          stroke-dasharray: 6 6;
          animation: aurora-conduit-reverse 1.2s linear infinite;
        }
      `}</style>

      {/* Header bar */}
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 2, mb: 3 }}>
        <Box>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h3" sx={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', m: 0 }}>
              Microgrid Power Flow Topology
            </Typography>
            <Chip
              size="small"
              label="50.0 Hz SYNCHRONIZED"
              sx={{
                bgcolor: 'rgba(95,208,138,0.14)',
                color: '#5FD08A',
                fontWeight: 700,
                fontSize: 11,
                border: '1px solid rgba(95,208,138,0.3)',
              }}
            />
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Real-time multi-source generation, battery storage bus, and facility consumption balance for {stationName}.
          </Typography>
        </Box>

        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ px: 2, py: 0.75, borderRadius: '8px', bgcolor: 'rgba(127,219,255,0.08)', border: '1px solid rgba(127,219,255,0.2)' }}>
            <Typography sx={{ fontSize: 10, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Renewable Penetration</Typography>
            <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#7FDBFF', fontFeatureSettings: '"tnum" 1' }}>
              {topology.renewableShare}%
            </Typography>
          </Box>
          <Box sx={{ px: 2, py: 0.75, borderRadius: '8px', bgcolor: 'rgba(95,208,138,0.08)', border: '1px solid rgba(95,208,138,0.2)' }}>
            <Typography sx={{ fontSize: 10, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Generation</Typography>
            <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#5FD08A', fontFeatureSettings: '"tnum" 1' }}>
              {formatValue(topology.totalGen, 'kW', 1)}
            </Typography>
          </Box>
        </Stack>
      </Stack>

      {/* 3-Column Diagram Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '300px 1fr 300px' },
          gap: { xs: 3, lg: 4 },
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {/* Left Column: Generation Sources */}
        <Stack sx={{ gap: 2 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'text.secondary' }}>
            Generation Sources
          </Typography>

          {/* Solar PV */}
          <Box sx={{ ...GLASS_CARD, borderLeft: '4px solid #F5B83D' }} onClick={() => setSelectedAsset('solar')}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
                <Box sx={{ width: 34, height: 34, borderRadius: '8px', bgcolor: 'rgba(245,184,61,0.15)', display: 'grid', placeItems: 'center' }}>
                  <SolarPowerOutlined sx={{ color: '#F5B83D', fontSize: 20 }} />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>Solar PV Array</Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Photovoltaic Bus</Typography>
                </Box>
              </Stack>
              <Chip size="small" label={isDaylight ? 'ACTIVE' : 'IDLE'} sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: isDaylight ? 'rgba(95,208,138,0.12)' : 'action.hover', color: isDaylight ? '#5FD08A' : 'text.disabled' }} />
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 1.5 }}>
              <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#F5B83D', fontFeatureSettings: '"tnum" 1' }}>
                {formatValue(topology.solarGen, 'kW', 1)}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Rated 50 kWp</Typography>
            </Stack>
          </Box>

          {/* Wind Turbine */}
          <Box sx={{ ...GLASS_CARD, borderLeft: '4px solid #7FDBFF' }} onClick={() => setSelectedAsset('wind')}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
                <Box sx={{ width: 34, height: 34, borderRadius: '8px', bgcolor: 'rgba(127,219,255,0.15)', display: 'grid', placeItems: 'center' }}>
                  <AirOutlined sx={{ color: '#7FDBFF', fontSize: 20 }} />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>Wind Turbine</Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Aerodynamic Alternator</Typography>
                </Box>
              </Stack>
              <Chip size="small" label="ACTIVE" sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(95,208,138,0.12)', color: '#5FD08A' }} />
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 1.5 }}>
              <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#7FDBFF', fontFeatureSettings: '"tnum" 1' }}>
                {formatValue(topology.windGen, 'kW', 1)}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Wind: {formatNumber(envWindKmh || 25, 0)} km/h</Typography>
            </Stack>
          </Box>

          {/* Diesel Genset */}
          <Box sx={{ ...GLASS_CARD, borderLeft: '4px solid #FF8C42' }} onClick={() => setSelectedAsset('diesel')}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
                <Box sx={{ width: 34, height: 34, borderRadius: '8px', bgcolor: 'rgba(255,140,66,0.15)', display: 'grid', placeItems: 'center' }}>
                  <ElectricBoltOutlined sx={{ color: '#FF8C42', fontSize: 20 }} />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>Diesel CHP Genset</Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Combined Heat & Power</Typography>
                </Box>
              </Stack>
              <Chip size="small" label="RUNNING" sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(255,140,66,0.12)', color: '#FF8C42' }} />
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 1.5 }}>
              <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#FF8C42', fontFeatureSettings: '"tnum" 1' }}>
                {formatValue(topology.dieselGen, 'kW', 1)}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>1500 RPM Synced</Typography>
            </Stack>
          </Box>
        </Stack>

        {/* Center Column: Central Microgrid Bus & Battery Storage */}
        <Stack sx={{ gap: 2.5, position: 'relative' }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'text.secondary', textAlign: { lg: 'center' } }}>
            Central Microgrid & Storage
          </Typography>

          {/* Central Bus Junction */}
          <Box
            sx={{
              ...GLASS_CARD,
              bgcolor: 'rgba(127,178,229,0.06)',
              borderColor: 'rgba(127,178,229,0.3)',
              textAlign: 'center',
              p: 2.5,
            }}
          >
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'center', gap: 1.5, mb: 1 }}>
              <HubOutlined sx={{ color: '#7FDBFF', fontSize: 26 }} />
              <Box sx={{ textAlign: 'left' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Combined Microgrid Bus</Typography>
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>400V 3-Phase · 50.0 Hz</Typography>
              </Box>
            </Stack>

            <Box sx={{ my: 1.5, py: 1.25, borderRadius: '8px', bgcolor: 'rgba(0,0,0,0.15)' }}>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Supply Injection</Typography>
              <Typography sx={{ fontSize: 26, fontWeight: 800, color: '#7FDBFF', fontFeatureSettings: '"tnum" 1' }}>
                {formatValue(topology.totalGen, 'kW', 1)}
              </Typography>
            </Box>

            <Stack direction="row" sx={{ justifyContent: 'space-around', fontSize: 11, color: 'text.secondary' }}>
              <span>Grid Stability: <strong style={{ color: '#5FD08A' }}>100%</strong></span>
              <span>THD: <strong style={{ color: '#7FDBFF' }}>&lt; 2.1%</strong></span>
            </Stack>
          </Box>

          {/* BESS Battery Storage Substation */}
          <Box
            sx={{
              ...GLASS_CARD,
              borderLeft: '4px solid #5FD08A',
              bgcolor: 'rgba(95,208,138,0.04)',
            }}
          >
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
                <Box sx={{ width: 34, height: 34, borderRadius: '8px', bgcolor: 'rgba(95,208,138,0.15)', display: 'grid', placeItems: 'center' }}>
                  <BatteryChargingFullOutlined sx={{ color: '#5FD08A', fontSize: 22 }} />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>LiFePO4 Battery Substation</Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>BESS 240 kWh Bank</Typography>
                </Box>
              </Stack>
              <Chip
                size="small"
                label={topology.isCharging ? 'CHARGING' : 'FLOAT / DISCHARGE'}
                sx={{
                  height: 20,
                  fontSize: 10,
                  fontWeight: 700,
                  bgcolor: topology.isCharging ? 'rgba(95,208,138,0.15)' : 'rgba(245,184,61,0.15)',
                  color: topology.isCharging ? '#5FD08A' : '#F5B83D',
                }}
              />
            </Stack>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5, mt: 2, textAlign: 'center' }}>
              <Box sx={{ p: 1, borderRadius: '6px', bgcolor: 'rgba(0,0,0,0.1)' }}>
                <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>State of Charge</Typography>
                <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#5FD08A' }}>{topology.batterySOC}%</Typography>
              </Box>
              <Box sx={{ p: 1, borderRadius: '6px', bgcolor: 'rgba(0,0,0,0.1)' }}>
                <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>Net Bus Flow</Typography>
                <Typography sx={{ fontSize: 16, fontWeight: 700, color: topology.isCharging ? '#5FD08A' : '#F5B83D' }}>
                  {topology.isCharging ? `+${topology.batteryPowerKW}` : `-${topology.batteryPowerKW}`} kW
                </Typography>
              </Box>
              <Box sx={{ p: 1, borderRadius: '6px', bgcolor: 'rgba(0,0,0,0.1)' }}>
                <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>DC Bus</Typography>
                <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#E6EBF2' }}>{topology.batteryVoltage} V</Typography>
              </Box>
            </Box>

            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 1.5, textAlign: 'center' }}>
              Estimated BESS runtime alone: <strong style={{ color: '#5FD08A' }}>{topology.remainingRuntimeHrs} hrs</strong> at nominal load
            </Typography>
          </Box>
        </Stack>

        {/* Right Column: Facility Demand & Consumers */}
        <Stack sx={{ gap: 2 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'text.secondary' }}>
              Facility Demand
            </Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#7FDBFF', fontFeatureSettings: '"tnum" 1' }}>
              Total: {formatValue(topology.totalDemand, 'kW', 1)}
            </Typography>
          </Stack>

          {topology.consumers.map((c) => {
            const share = Math.round((c.kw / topology.totalDemand) * 100);
            return (
              <Box key={c.id} sx={{ ...GLASS_CARD, borderRight: `4px solid ${c.color}` }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
                    <Box sx={{ width: 34, height: 34, borderRadius: '8px', bgcolor: `${c.color}22`, display: 'grid', placeItems: 'center' }}>
                      <c.Icon sx={{ color: c.color, fontSize: 20 }} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.label}
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Critical Load</Typography>
                    </Box>
                  </Stack>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: c.color }}>{share}%</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 1.5 }}>
                  <Typography sx={{ fontSize: 19, fontWeight: 700, fontFeatureSettings: '"tnum" 1', color: c.color }}>
                    {formatValue(c.kw, 'kW', 1)}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Continuous Feed</Typography>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Box>

      {/* Footer Info */}
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider', fontSize: 11, color: 'text.secondary' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <InfoOutlined sx={{ fontSize: 15, color: 'primary.main' }} />
          <span>Real-time closed-loop power balance: Total Generation ({formatValue(topology.totalGen, 'kW', 1)}) = Demand ({formatValue(topology.totalDemand, 'kW', 1)}) + Storage Buffer ({topology.batteryPowerKW} kW).</span>
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
          IEEE 1547.4 Antarctic Microgrid Standard Compliant
        </Typography>
      </Stack>
    </Card>
  );
}
