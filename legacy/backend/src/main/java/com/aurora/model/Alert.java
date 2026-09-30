package com.aurora.model;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * An alert raised when a sensor crosses a threshold or AI detects an anomaly.
 */
@Entity
@Table(name = "alerts", indexes = {
    @Index(name = "idx_alert_station_active", columnList = "stationId, acknowledged")
})
public class Alert {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 20)
    private String stationId;

    @Column(nullable = false, length = 30)
    private String buildingId;

    @Column(length = 30)
    private String sensorId;

    @Column(nullable = false, length = 10)
    private String level;    // "warning" or "critical"

    @Column(nullable = false, length = 20)
    private String source;   // "threshold", "chronos", "dependency", "combined"

    @Column(length = 500)
    private String message;

    @Column(nullable = false)
    private Instant timestamp;

    @Column(nullable = false)
    private Boolean acknowledged = false;

    private Instant acknowledgedAt;

    public Alert() {}

    public Alert(String stationId, String buildingId, String sensorId,
                 String level, String source, String message) {
        this.stationId = stationId;
        this.buildingId = buildingId;
        this.sensorId = sensorId;
        this.level = level;
        this.source = source;
        this.message = message;
        this.timestamp = Instant.now();
        this.acknowledged = false;
    }

    // Getters and setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getStationId() { return stationId; }
    public void setStationId(String stationId) { this.stationId = stationId; }
    public String getBuildingId() { return buildingId; }
    public void setBuildingId(String buildingId) { this.buildingId = buildingId; }
    public String getSensorId() { return sensorId; }
    public void setSensorId(String sensorId) { this.sensorId = sensorId; }
    public String getLevel() { return level; }
    public void setLevel(String level) { this.level = level; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public Instant getTimestamp() { return timestamp; }
    public void setTimestamp(Instant timestamp) { this.timestamp = timestamp; }
    public Boolean getAcknowledged() { return acknowledged; }
    public void setAcknowledged(Boolean acknowledged) { this.acknowledged = acknowledged; }
    public Instant getAcknowledgedAt() { return acknowledgedAt; }
    public void setAcknowledgedAt(Instant acknowledgedAt) { this.acknowledgedAt = acknowledgedAt; }
}
