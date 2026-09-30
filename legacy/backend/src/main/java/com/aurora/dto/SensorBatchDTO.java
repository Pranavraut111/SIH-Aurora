package com.aurora.dto;

import java.util.Map;
import java.util.List;

/**
 * Payload sent from the Python simulator to the backend.
 * Contains all sensor readings for one tick, plus organic event data.
 */
public record SensorBatchDTO(
    String stationId,
    long timestamp,
    Map<String, Map<String, SensorValueDTO>> readings,  // buildingId -> sensorId -> value
    List<Map<String, Object>> eventTimeline,             // Recent events from simulator
    List<String> activePatterns                           // Currently active weather patterns
) {
    public record SensorValueDTO(double value, String unit) {}
}
