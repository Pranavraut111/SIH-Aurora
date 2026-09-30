package com.aurora.dto;

/**
 * Response from the Python AI service for anomaly analysis.
 */
public record AiVerdictDTO(
    String buildingId,
    String sensorId,
    boolean chronosAnomaly,
    boolean dependencyRisk,
    String verdict,           // "normal", "warning", "critical"
    String explanation,
    double predictedValue,
    double actualValue,
    double anomalyScore
) {}
