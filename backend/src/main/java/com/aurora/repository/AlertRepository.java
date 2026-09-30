package com.aurora.repository;

import com.aurora.model.Alert;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AlertRepository extends JpaRepository<Alert, Long> {

    /** Active (unacknowledged) alerts for a station, newest first */
    List<Alert> findByStationIdAndAcknowledgedFalseOrderByTimestampDesc(String stationId);

    /** All alerts for a station, newest first */
    List<Alert> findByStationIdOrderByTimestampDesc(String stationId);

    /** Check if there's already an active alert for this building+sensor */
    boolean existsByStationIdAndBuildingIdAndSensorIdAndAcknowledgedFalse(
        String stationId, String buildingId, String sensorId);
}
