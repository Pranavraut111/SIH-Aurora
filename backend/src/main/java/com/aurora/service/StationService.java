package com.aurora.service;

import com.aurora.dto.SensorBatchDTO;
import com.aurora.dto.StationStateDTO;
import com.aurora.model.Alert;
import com.aurora.model.SensorReading;
import com.aurora.repository.AlertRepository;
import com.aurora.repository.SensorReadingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Core service managing station state, threshold alerts, and delta-encoding.
 * All in-memory state is keyed by stationId so Maitri and Bharati
 * maintain completely independent state.
 */
@Service
public class StationService {

    private static final Logger log = LoggerFactory.getLogger(StationService.class);

    private final SensorReadingRepository readingRepo;
    private final AlertRepository alertRepo;

    // ── In-memory state — ALL keyed by stationId ─────────────────
    // stationId -> buildingId -> sensorId -> latest value
    private final Map<String, Map<String, Map<String, Double>>> latestSensors = new ConcurrentHashMap<>();
    // stationId -> buildingId -> alert level
    private final Map<String, Map<String, String>> buildingAlerts = new ConcurrentHashMap<>();
    // stationId -> (buildingId.sensorId) -> previous value (for delta encoding)
    private final Map<String, Map<String, Double>> previousValues = new ConcurrentHashMap<>();
    // stationId -> bandwidth tracking
    private final Map<String, long[]> bandwidthByStation = new ConcurrentHashMap<>();
    // Connection simulation (per-station)
    private final Map<String, Boolean> connectedByStation = new ConcurrentHashMap<>();
    // Queued readings during offline (per-station)
    private final Map<String, List<SensorReading>> offlineQueues = new ConcurrentHashMap<>();
    // stationId -> latest event timeline from simulator
    private final Map<String, List<Map<String, Object>>> eventTimelineByStation = new ConcurrentHashMap<>();
    // stationId -> currently active organic patterns
    private final Map<String, List<String>> activePatternsByStation = new ConcurrentHashMap<>();

    // ── Threshold definitions ────────────────────────────────────
    private static final Map<String, ThresholdDef> THRESHOLDS = Map.ofEntries(
        Map.entry("gen_power",     new ThresholdDef(80.0, 40.0, null, null)),
        Map.entry("gen_rpm",       new ThresholdDef(1200.0, 800.0, null, null)),
        Map.entry("gen_temp",      new ThresholdDef(null, null, 95.0, 105.0)),
        Map.entry("heat_a_temp",   new ThresholdDef(55.0, 40.0, null, null)),
        Map.entry("heat_b_temp",   new ThresholdDef(50.0, 35.0, null, null)),
        Map.entry("water_level",   new ThresholdDef(25.0, 10.0, null, null)),
        Map.entry("comms_signal",  new ThresholdDef(-80.0, -100.0, null, null)),
        Map.entry("lq_temp",      new ThresholdDef(16.0, 12.0, null, null)),
        Map.entry("lq_co2",       new ThresholdDef(null, null, 1200.0, 1500.0)),
        Map.entry("store_fuel",    new ThresholdDef(40.0, 15.0, null, null)),
        Map.entry("store_food",    new ThresholdDef(30.0, 14.0, null, null)),
        Map.entry("store_spares",  new ThresholdDef(50.0, 20.0, null, null)),
        Map.entry("env_wind",      new ThresholdDef(null, null, 80.0, 120.0))
    );

    record ThresholdDef(Double warningLow, Double criticalLow,
                        Double warningHigh, Double criticalHigh) {}

    // ── Building name mapping ────────────────────────────────────
    private static final Map<String, String> BUILDING_NAMES = Map.of(
        "generator", "Generator Shed",
        "heating", "Heating Zone A",
        "heatingB", "Heating Zone B",
        "waterTank", "Water Treatment",
        "commsMast", "Comms Tower",
        "livingQuarters", "Living Quarters",
        "storage", "Logistics Store",
        "lab", "Research Lab"
    );

    public StationService(SensorReadingRepository readingRepo, AlertRepository alertRepo) {
        this.readingRepo = readingRepo;
        this.alertRepo = alertRepo;
    }

    /**
     * Process a batch of sensor readings from the simulator.
     * Stores in DB, checks thresholds, updates in-memory state.
     * All state is keyed by batch.stationId().
     */
    public StationStateDTO processBatch(SensorBatchDTO batch) {
        String stationId = batch.stationId();

        // Ensure station maps exist
        latestSensors.putIfAbsent(stationId, new ConcurrentHashMap<>());
        buildingAlerts.putIfAbsent(stationId, new ConcurrentHashMap<>());
        previousValues.putIfAbsent(stationId, new ConcurrentHashMap<>());
        bandwidthByStation.putIfAbsent(stationId, new long[]{0, 0});
        connectedByStation.putIfAbsent(stationId, true);
        offlineQueues.putIfAbsent(stationId, Collections.synchronizedList(new ArrayList<>()));

        Map<String, Map<String, Double>> stationSensors = latestSensors.get(stationId);
        Map<String, String> stationAlerts = buildingAlerts.get(stationId);
        Map<String, Double> stationPrev = previousValues.get(stationId);
        long[] bandwidth = bandwidthByStation.get(stationId);
        boolean connected = connectedByStation.getOrDefault(stationId, true);

        List<SensorReading> readings = new ArrayList<>();
        int rawSize = 0;
        int compressedSize = 0;

        for (var buildingEntry : batch.readings().entrySet()) {
            String buildingId = buildingEntry.getKey();
            stationSensors.putIfAbsent(buildingId, new ConcurrentHashMap<>());
            String buildingAlert = "normal";

            for (var sensorEntry : buildingEntry.getValue().entrySet()) {
                String sensorId = sensorEntry.getKey();
                double value = sensorEntry.getValue().value();
                String unit = sensorEntry.getValue().unit();

                // Create reading entity
                SensorReading reading = new SensorReading(
                    stationId, buildingId, sensorId, value, unit);

                // Delta encoding: only count as "transmitted" if value changed significantly
                String key = buildingId + "." + sensorId;
                double prev = stationPrev.getOrDefault(key, Double.MAX_VALUE);
                double delta = Math.abs(value - prev);
                rawSize += 20;

                if (delta > 0.1 || prev == Double.MAX_VALUE) {
                    compressedSize += 20;
                    stationPrev.put(key, value);
                }

                readings.add(reading);
                stationSensors.get(buildingId).put(sensorId, value);

                // Check thresholds
                String sensorAlert = checkThreshold(sensorId, value);
                if ("critical".equals(sensorAlert)) {
                    buildingAlert = "critical";
                    maybeCreateAlert(stationId, buildingId, sensorId, "critical",
                        "threshold", String.format("%s: %.1f %s exceeds critical threshold",
                            sensorId, value, unit));
                } else if ("warning".equals(sensorAlert) && !"critical".equals(buildingAlert)) {
                    buildingAlert = "warning";
                    maybeCreateAlert(stationId, buildingId, sensorId, "warning",
                        "threshold", String.format("%s: %.1f %s exceeds warning threshold",
                            sensorId, value, unit));
                }
            }

            stationAlerts.put(buildingId, buildingAlert);
        }

        // Track bandwidth
        bandwidth[0] += rawSize;
        bandwidth[1] += compressedSize;

        // Persist readings
        if (connected) {
            readingRepo.saveAll(readings);
        } else {
            offlineQueues.get(stationId).addAll(readings);
        }

        // Store event timeline and active patterns from simulator
        if (batch.eventTimeline() != null) {
            eventTimelineByStation.put(stationId, batch.eventTimeline());
        }
        if (batch.activePatterns() != null) {
            activePatternsByStation.put(stationId, batch.activePatterns());
        }

        return buildState(stationId);
    }

    /**
     * Build the full station state DTO for WebSocket push.
     * Returns only data for the requested stationId.
     */
    public StationStateDTO buildState(String stationId) {
        List<Alert> activeAlerts = alertRepo
            .findByStationIdAndAcknowledgedFalseOrderByTimestampDesc(stationId);

        List<StationStateDTO.ActiveAlertDTO> alertDtos = activeAlerts.stream()
            .map(a -> new StationStateDTO.ActiveAlertDTO(
                a.getId(),
                a.getBuildingId(),
                BUILDING_NAMES.getOrDefault(a.getBuildingId(), a.getBuildingId()),
                a.getSensorId(),
                a.getLevel(),
                a.getSource(),
                a.getMessage(),
                a.getTimestamp().toEpochMilli()
            ))
            .toList();

        Map<String, Map<String, Double>> stationSensors =
            latestSensors.getOrDefault(stationId, Map.of());
        Map<String, String> stationAlerts =
            buildingAlerts.getOrDefault(stationId, Map.of());
        long[] bandwidth = bandwidthByStation.getOrDefault(stationId, new long[]{0, 0});
        boolean connected = connectedByStation.getOrDefault(stationId, true);
        double savedKB = (bandwidth[0] - bandwidth[1]) / 1024.0;

        return new StationStateDTO(
            stationId,
            System.currentTimeMillis(),
            new HashMap<>(stationSensors),
            new HashMap<>(stationAlerts),
            alertDtos,
            connected,
            new StationStateDTO.BandwidthDTO(bandwidth[0], bandwidth[1],
                Math.max(0, savedKB)),
            eventTimelineByStation.getOrDefault(stationId, List.of()),
            activePatternsByStation.getOrDefault(stationId, List.of())
        );
    }

    /**
     * Check a sensor value against its threshold.
     */
    private String checkThreshold(String sensorId, double value) {
        ThresholdDef t = THRESHOLDS.get(sensorId);
        if (t == null) return "normal";

        if (t.criticalHigh != null && value >= t.criticalHigh) return "critical";
        if (t.criticalLow != null && value <= t.criticalLow) return "critical";
        if (t.warningHigh != null && value >= t.warningHigh) return "warning";
        if (t.warningLow != null && value <= t.warningLow) return "warning";
        return "normal";
    }

    /**
     * Only create a new alert if one doesn't already exist for this sensor.
     */
    private void maybeCreateAlert(String stationId, String buildingId,
                                   String sensorId, String level, String source, String message) {
        if (!alertRepo.existsByStationIdAndBuildingIdAndSensorIdAndAcknowledgedFalse(
                stationId, buildingId, sensorId)) {
            Alert alert = new Alert(stationId, buildingId, sensorId, level, source, message);
            alertRepo.save(alert);
            log.info("[{}] Alert: [{}] {} — {}", stationId.toUpperCase(), level.toUpperCase(), buildingId, message);
        }
    }

    /**
     * Acknowledge an alert by ID.
     */
    public void acknowledgeAlert(Long alertId) {
        alertRepo.findById(alertId).ifPresent(alert -> {
            alert.setAcknowledged(true);
            alert.setAcknowledgedAt(java.time.Instant.now());
            alertRepo.save(alert);
            log.info("Alert {} acknowledged", alertId);
        });
    }

    // ── Connection simulation (per-station) ─────────────────────
    public void setConnected(String stationId, boolean connected) {
        boolean wasDisconnected = !connectedByStation.getOrDefault(stationId, true);
        connectedByStation.put(stationId, connected);

        if (connected && wasDisconnected) {
            List<SensorReading> queue = offlineQueues.getOrDefault(stationId, List.of());
            if (!queue.isEmpty()) {
                log.info("[{}] Reconnected — syncing {} queued readings", stationId, queue.size());
                readingRepo.saveAll(new ArrayList<>(queue));
                queue.clear();
            }
        }
    }

    // Legacy: toggle for the first station
    public void setConnected(boolean connected) {
        setConnected("maitri", connected);
    }

    public boolean isConnected() { return isConnected("maitri"); }
    public boolean isConnected(String stationId) {
        return connectedByStation.getOrDefault(stationId, true);
    }

    public Map<String, Map<String, Double>> getLatestSensors(String stationId) {
        return latestSensors.getOrDefault(stationId, Map.of());
    }

    // Legacy: return first station's sensors
    public Map<String, Map<String, Double>> getLatestSensors() {
        return getLatestSensors("maitri");
    }

    public Map<String, String> getBuildingAlerts(String stationId) {
        return buildingAlerts.getOrDefault(stationId, Map.of());
    }

    public Map<String, String> getBuildingAlerts() {
        return getBuildingAlerts("maitri");
    }

    public int getOfflineQueueSize() { return getOfflineQueueSize("maitri"); }
    public int getOfflineQueueSize(String stationId) {
        return offlineQueues.getOrDefault(stationId, List.of()).size();
    }

    /** Get all known station IDs */
    public Set<String> getKnownStations() {
        return latestSensors.keySet();
    }
}
