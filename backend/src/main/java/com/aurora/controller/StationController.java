package com.aurora.controller;

import com.aurora.dto.SensorBatchDTO;
import com.aurora.dto.StationStateDTO;
import com.aurora.service.AiIntegrationService;
import com.aurora.service.StationService;
import com.aurora.websocket.StationWebSocketHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * REST API for ingesting sensor data and managing station state.
 * The Python simulator POSTs sensor batches here every tick.
 */
@RestController
@RequestMapping("/api")
public class StationController {

    private static final Logger log = LoggerFactory.getLogger(StationController.class);

    private final StationService stationService;
    private final StationWebSocketHandler wsHandler;
    private final AiIntegrationService aiService;

    public StationController(StationService stationService, StationWebSocketHandler wsHandler,
                             AiIntegrationService aiService) {
        this.stationService = stationService;
        this.wsHandler = wsHandler;
        this.aiService = aiService;
    }

    /**
     * Receive a batch of sensor readings from the simulator.
     * Processes, stores, checks thresholds, and broadcasts via WebSocket.
     */
    @PostMapping("/sensors/batch")
    public ResponseEntity<StationStateDTO> ingestBatch(@RequestBody SensorBatchDTO batch) {
        StationStateDTO state = stationService.processBatch(batch);
        // Broadcast to all connected WebSocket clients
        wsHandler.broadcast(state);
        return ResponseEntity.ok(state);
    }

    /**
     * Get the current station state (for initial page load / polling fallback).
     */
    @GetMapping("/station/{stationId}/state")
    public ResponseEntity<StationStateDTO> getState(@PathVariable String stationId) {
        return ResponseEntity.ok(stationService.buildState(stationId));
    }

    /**
     * Acknowledge an alert.
     */
    @PostMapping("/alerts/{alertId}/acknowledge")
    public ResponseEntity<Void> acknowledgeAlert(@PathVariable Long alertId) {
        stationService.acknowledgeAlert(alertId);
        return ResponseEntity.ok().build();
    }

    /**
     * Toggle connection simulation (satellite link up/down).
     */
    @PostMapping("/connection/toggle")
    public ResponseEntity<Map<String, Object>> toggleConnection() {
        boolean newState = !stationService.isConnected();
        stationService.setConnected(newState);
        log.info("📡 Connection toggled: {}", newState ? "CONNECTED" : "OFFLINE");
        return ResponseEntity.ok(Map.of(
            "connected", newState,
            "offlineQueueSize", stationService.getOfflineQueueSize()
        ));
    }

    /**
     * Set connection state explicitly.
     */
    @PostMapping("/connection/{state}")
    public ResponseEntity<Map<String, Object>> setConnection(@PathVariable String state) {
        boolean connected = "connect".equalsIgnoreCase(state) || "true".equalsIgnoreCase(state);
        stationService.setConnected(connected);
        return ResponseEntity.ok(Map.of(
            "connected", connected,
            "offlineQueueSize", stationService.getOfflineQueueSize()
        ));
    }

    /**
     * Get AI analysis results (latest Chronos verdicts + dependency alerts).
     * Accepts stationId query param to return station-specific results.
     */
    @GetMapping("/ai/analysis")
    public ResponseEntity<Map<String, Object>> getAiAnalysis(
            @RequestParam(defaultValue = "maitri") String stationId) {
        var analysis = aiService.getLatestAnalysis(stationId);
        return ResponseEntity.ok(Map.of(
            "stationId", stationId,
            "overallHealth", aiService.getOverallHealth(stationId),
            "dependencyAlerts", aiService.getDependencyAlerts(stationId),
            "hasAnalysis", analysis != null
        ));
    }

    /**
     * Health check endpoint.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
            "status", "UP",
            "service", "aurora-backend",
            "wsClients", wsHandler.getConnectedClients(),
            "connected", stationService.isConnected(),
            "aiHealth", aiService.getOverallHealth()
        ));
    }
}
