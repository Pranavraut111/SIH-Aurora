package com.aurora.service;

import com.aurora.dto.AiVerdictDTO;
import com.aurora.model.Alert;
import com.aurora.repository.AlertRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Calls the Python AI service every tick with current sensor readings
 * and processes the anomaly verdicts and dependency cascade alerts.
 * All state is keyed by stationId — Maitri and Bharati get independent analysis.
 */
@Service
public class AiIntegrationService {

    private static final Logger log = LoggerFactory.getLogger(AiIntegrationService.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(3))
        .build();

    private final StationService stationService;
    private final AlertRepository alertRepo;

    @Value("${aurora.ai-service.url:http://localhost:8000}")
    private String aiServiceUrl;

    // Per-station AI analysis results
    private final Map<String, JsonNode> latestAnalysisByStation = new ConcurrentHashMap<>();
    private final Map<String, String> healthByStation = new ConcurrentHashMap<>();
    private final Map<String, List<Map<String, Object>>> dependencyAlertsByStation = new ConcurrentHashMap<>();

    public AiIntegrationService(StationService stationService, AlertRepository alertRepo) {
        this.stationService = stationService;
        this.alertRepo = alertRepo;
    }

    /**
     * Periodically call the AI service with current sensor readings
     * for ALL known stations.
     */
    @Scheduled(fixedDelayString = "${aurora.simulator.tick-interval-ms:4000}")
    public void analyzeCurrentState() {
        Set<String> stations = stationService.getKnownStations();
        if (stations.isEmpty()) return;

        for (String stationId : stations) {
            analyzeStation(stationId);
        }
    }

    /**
     * Analyze a single station's current sensor state.
     */
    private void analyzeStation(String stationId) {
        Map<String, Map<String, Double>> sensors = stationService.getLatestSensors(stationId);
        if (sensors.isEmpty()) return;

        try {
            // Build request payload
            ObjectNode payload = mapper.createObjectNode();
            payload.put("stationId", stationId);

            ArrayNode buildings = mapper.createArrayNode();
            for (var entry : sensors.entrySet()) {
                ObjectNode building = mapper.createObjectNode();
                building.put("buildingId", entry.getKey());

                ArrayNode sensorArray = mapper.createArrayNode();
                for (var sensorEntry : entry.getValue().entrySet()) {
                    ObjectNode sensor = mapper.createObjectNode();
                    sensor.put("sensorId", sensorEntry.getKey());
                    sensor.put("value", sensorEntry.getValue());
                    sensor.put("unit", "");
                    sensorArray.add(sensor);
                }
                building.set("sensors", sensorArray);
                buildings.add(building);
            }
            payload.set("buildings", buildings);

            // Call AI service
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(aiServiceUrl + "/analyze"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
                .timeout(Duration.ofSeconds(5))
                .build();

            HttpResponse<String> response = httpClient.send(request,
                HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200) {
                JsonNode result = mapper.readTree(response.body());
                latestAnalysisByStation.put(stationId, result);
                healthByStation.put(stationId, result.path("overallHealth").asText("healthy"));

                // Process verdicts into alerts
                JsonNode verdicts = result.path("verdicts");
                if (verdicts.isArray()) {
                    for (JsonNode v : verdicts) {
                        String verdict = v.path("verdict").asText("normal");
                        if (!"normal".equals(verdict) && v.path("chronosAnomaly").asBoolean()) {
                            String buildingId = v.path("buildingId").asText();
                            String sensorId = v.path("sensorId").asText();
                            String explanation = v.path("explanation").asText();

                            // Create AI-sourced alert (deduplicated, station-scoped)
                            if (!alertRepo.existsByStationIdAndBuildingIdAndSensorIdAndAcknowledgedFalse(
                                    stationId, buildingId, sensorId + "_ai")) {
                                Alert alert = new Alert(stationId, buildingId,
                                    sensorId + "_ai", verdict, "chronos", explanation);
                                alertRepo.save(alert);
                                log.info("[{}] Chronos alert: [{}] {} — {}",
                                    stationId.toUpperCase(), verdict.toUpperCase(), buildingId, explanation);
                            }
                        }
                    }
                }

                // Process dependency alerts
                JsonNode depAlerts = result.path("dependencyAlerts");
                if (depAlerts.isArray()) {
                    List<Map<String, Object>> deps = new ArrayList<>();
                    for (JsonNode d : depAlerts) {
                        Map<String, Object> dep = new HashMap<>();
                        dep.put("sourceBuilding", d.path("sourceBuilding").asText());
                        dep.put("sourceName", d.path("sourceName").asText());
                        dep.put("affectedBuilding", d.path("affectedBuilding").asText());
                        dep.put("affectedName", d.path("affectedName").asText());
                        dep.put("severity", d.path("severity").asText());
                        dep.put("message", d.path("message").asText());
                        deps.add(dep);

                        // Create dependency alert (station-scoped)
                        String affected = d.path("affectedBuilding").asText();
                        String source = d.path("sourceBuilding").asText();
                        String severity = d.path("severity").asText();
                        if (!alertRepo.existsByStationIdAndBuildingIdAndSensorIdAndAcknowledgedFalse(
                                stationId, affected, "dep_" + source)) {
                            Alert depAlert = new Alert(stationId, affected,
                                "dep_" + source, severity, "dependency",
                                d.path("message").asText());
                            alertRepo.save(depAlert);
                            log.info("[{}] Dependency alert: {}", stationId.toUpperCase(), d.path("message").asText());
                        }
                    }
                    dependencyAlertsByStation.put(stationId, deps);
                }
            }
        } catch (java.net.ConnectException e) {
            // AI service not running — silently skip
        } catch (Exception e) {
            log.debug("[{}] AI service call failed: {}", stationId, e.getMessage());
        }
    }

    // Per-station getters
    public JsonNode getLatestAnalysis(String stationId) {
        return latestAnalysisByStation.get(stationId);
    }

    public String getOverallHealth(String stationId) {
        return healthByStation.getOrDefault(stationId, "healthy");
    }

    public List<Map<String, Object>> getDependencyAlerts(String stationId) {
        return dependencyAlertsByStation.getOrDefault(stationId, Collections.emptyList());
    }

    // Legacy single-station getters (for existing code that doesn't pass stationId)
    public JsonNode getLatestAnalysis() { return getLatestAnalysis("maitri"); }
    public String getOverallHealth() { return getOverallHealth("maitri"); }
    public List<Map<String, Object>> getDependencyAlerts() { return getDependencyAlerts("maitri"); }
}
