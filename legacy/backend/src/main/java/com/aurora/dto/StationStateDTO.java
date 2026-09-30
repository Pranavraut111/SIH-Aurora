package com.aurora.dto;

import java.util.List;
import java.util.Map;

/**
 * Full station state pushed over WebSocket every tick.
 * This is what the React frontend receives.
 * Includes eventTimeline and activePatterns from the simulator.
 */
public record StationStateDTO(
    String stationId,
    long timestamp,
    Map<String, Map<String, Double>> sensors,      // buildingId -> sensorId -> value
    Map<String, String> alerts,                     // buildingId -> "normal"/"warning"/"critical"
    List<ActiveAlertDTO> activeAlerts,
    boolean connected,
    BandwidthDTO bandwidth,
    List<Map<String, Object>> eventTimeline,        // Chronological event log from simulator
    List<String> activePatterns                     // Currently active weather/organic patterns
) {
    // Backwards-compatible constructor (without timeline/patterns)
    public StationStateDTO(
        String stationId, long timestamp,
        Map<String, Map<String, Double>> sensors, Map<String, String> alerts,
        List<ActiveAlertDTO> activeAlerts, boolean connected, BandwidthDTO bandwidth
    ) {
        this(stationId, timestamp, sensors, alerts, activeAlerts, connected,
             bandwidth, List.of(), List.of());
    }

    public record ActiveAlertDTO(
        Long id,
        String buildingId,
        String buildingName,
        String sensorId,
        String level,
        String source,
        String message,
        long timestamp
    ) {}

    public record BandwidthDTO(
        long rawBytes,
        long compressedBytes,
        double savedKB
    ) {}
}
