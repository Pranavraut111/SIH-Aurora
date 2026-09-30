package com.aurora.repository;

import com.aurora.model.SensorReading;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.List;

public interface SensorReadingRepository extends JpaRepository<SensorReading, Long> {

    /** Latest N readings for a specific sensor */
    List<SensorReading> findTop60ByStationIdAndBuildingIdAndSensorIdOrderByRecordedAtDesc(
        String stationId, String buildingId, String sensorId);

    /** Latest reading for every sensor in a building */
    @Query("""
        SELECT sr FROM SensorReading sr
        WHERE sr.stationId = :stationId AND sr.buildingId = :buildingId
        AND sr.recordedAt = (
            SELECT MAX(sr2.recordedAt) FROM SensorReading sr2
            WHERE sr2.stationId = sr.stationId
            AND sr2.buildingId = sr.buildingId
            AND sr2.sensorId = sr.sensorId
        )
    """)
    List<SensorReading> findLatestByStationAndBuilding(
        @Param("stationId") String stationId,
        @Param("buildingId") String buildingId);

    /** All readings since a timestamp (for sync-on-reconnect) */
    List<SensorReading> findByStationIdAndRecordedAtAfterOrderByRecordedAtAsc(
        String stationId, Instant since);

    /** Count readings for bandwidth tracking */
    long countByStationIdAndRecordedAtAfter(String stationId, Instant since);
}
