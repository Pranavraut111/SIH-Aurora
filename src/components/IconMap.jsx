/* ═══════════════════════════════════════════════════════════════
   Aurora — Icon Map
   Centralized mapping from string icon keys to Lucide React icons.
   All icons use consistent 1.5px stroke, sized via props.
   ═══════════════════════════════════════════════════════════════ */
import {
  LuLayoutDashboard,
  LuBuilding2,
  LuZap,
  LuPackage,
  LuThermometerSnowflake,
  LuSparkles,
  LuTriangleAlert,
  LuSatelliteDish,
  LuGauge,
  LuWind,
  LuShieldCheck,
  LuUnplug,
  LuMapPin,
  LuFuel,
  LuFlame,
  LuDroplets,
  LuRadioTower,
  LuX,
  LuChevronDown,
  LuRefreshCw,
  LuArrowUp,
  LuArrowDown,
  LuActivity,
  LuSignal,
  LuServer,
  LuCloudOff,
  LuSnowflake,
  LuCircleDot,
  LuPlug,
  LuRotateCcw,
  LuPlay,
  LuSettings,
  LuMaximize,
  LuTag,
  LuLayers,
  LuTrendingUp,
  LuTrendingDown,
  LuCpu,
  LuBox,
  LuWifi,
  LuWifiOff,
  LuBrain,
  LuHouse,
  LuMicroscope,
} from 'react-icons/lu';

const ICON_MAP = {
  // Nav modules
  overview: LuLayoutDashboard,
  infrastructure: LuBuilding2,
  energy: LuZap,
  logistics: LuPackage,
  environmental: LuThermometerSnowflake,
  ai: LuSparkles,

  // Buildings
  fuel: LuFuel,
  flame: LuFlame,
  droplets: LuDroplets,
  'radio-tower': LuRadioTower,
  house: LuHouse,
  package: LuPackage,
  microscope: LuMicroscope,
  generator: LuFuel,
  heating: LuFlame,
  heatingB: LuFlame,
  waterTank: LuDroplets,
  commsMast: LuRadioTower,
  livingQuarters: LuHouse,
  storage: LuPackage,
  lab: LuMicroscope,

  // Status/UI
  alert: LuTriangleAlert,
  satellite: LuSatelliteDish,
  gauge: LuGauge,
  wind: LuWind,
  shield: LuShieldCheck,
  unplug: LuUnplug,
  plug: LuPlug,
  pin: LuMapPin,
  close: LuX,
  x: LuX,
  chevronDown: LuChevronDown,
  refresh: LuRefreshCw,
  reset: LuRotateCcw,
  arrowUp: LuArrowUp,
  arrowDown: LuArrowDown,
  activity: LuActivity,
  signal: LuSignal,
  server: LuServer,
  cloudOff: LuCloudOff,
  snowflake: LuSnowflake,
  dot: LuCircleDot,
  play: LuPlay,
  settings: LuSettings,
  maximize: LuMaximize,
  tag: LuTag,
  layers: LuLayers,
  trendUp: LuTrendingUp,
  trendDown: LuTrendingDown,
  cpu: LuCpu,
  box: LuBox,
  wifi: LuWifi,
  wifiOff: LuWifiOff,
  brain: LuBrain,
  zap: LuZap,
  thermometer: LuThermometerSnowflake,
};

/**
 * Get a Lucide icon component by string key.
 * Returns the component reference (not JSX). Render with <Icon size={16} />.
 */
export function getIcon(key) {
  return ICON_MAP[key] || LuCircleDot;
}

/**
 * Render a Lucide icon by string key.
 * @param {string} name - Icon key from ICON_MAP
 * @param {number} size - Icon size in px (default 16)
 * @param {string} className - Optional CSS class
 * @param {object} style - Optional inline style
 */
export function Icon({ name, size = 16, className = '', style = {}, ...rest }) {
  const IconComponent = ICON_MAP[name] || LuCircleDot;
  return <IconComponent size={size} className={className} style={style} strokeWidth={1.5} {...rest} />;
}

export default ICON_MAP;
