package com.aurora.model;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * A single sensor reading from any building's sensor.
 * This is the core data table — every tick from the simulator creates one row per sensor.
 */
@Entity
@Table(name = "sensor_readings", indexes = {
    @Index(name = "idx_reading_station_building", columnList = "stationId, buildingId"),
    @Index(name = "idx_reading_recorded_at", columnList = "recordedAt DESC")
})
public class SensorReading {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 20)
    private String stationId;    // "maitri" or "bharati"

    @Column(nullable = false, length = 30)
    private String buildingId;   // e.g. "generator", "heating", "lab"

    @Column(nullable = false, length = 30)
    private String sensorId;     // e.g. "gen_power", "env_temp"

    @Column(nullable = false)
    private Double sensorValue;

    @Column(nullable = false, length = 15)
    private String unit;         // e.g. "kW", "°C", "%"

    @Column(nullable = false)
    private Instant recordedAt;

    public SensorReading() {}

    public SensorReading(String stationId, String buildingId, String sensorId, Double sensorValue, String unit) {
        this.stationId = stationId;
        this.buildingId = buildingId;
        this.sensorId = sensorId;
        this.sensorValue = sensorValue;
        this.unit = unit;
        this.recordedAt = Instant.now();
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
    public Double getSensorValue() { return sensorValue; }
    public void setSensorValue(Double sensorValue) { this.sensorValue = sensorValue; }
    public String getUnit() { return unit; }
    public void setUnit(String unit) { this.unit = unit; }
    public Instant getRecordedAt() { return recordedAt; }
    public void setRecordedAt(Instant recordedAt) { this.recordedAt = recordedAt; }
}
