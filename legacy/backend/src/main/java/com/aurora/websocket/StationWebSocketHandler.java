package com.aurora.websocket;

import com.aurora.dto.StationStateDTO;
import com.aurora.service.StationService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * WebSocket handler that manages client connections and broadcasts
 * station state updates to all connected frontends.
 */
@Component
public class StationWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(StationWebSocketHandler.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
        log.info("🔌 WebSocket client connected: {} (total: {})",
            session.getId(), sessions.size());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
        log.info("🔌 WebSocket client disconnected: {} (total: {})",
            session.getId(), sessions.size());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        // Clients can send commands (e.g., acknowledge alert, toggle connection)
        log.debug("Received from client: {}", message.getPayload());
    }

    /**
     * Broadcast a station state update to all connected clients.
     */
    public void broadcast(StationStateDTO state) {
        if (sessions.isEmpty()) return;

        try {
            String json = mapper.writeValueAsString(state);
            TextMessage msg = new TextMessage(json);

            for (WebSocketSession session : sessions) {
                if (session.isOpen()) {
                    try {
                        session.sendMessage(msg);
                    } catch (IOException e) {
                        log.warn("Failed to send to session {}: {}",
                            session.getId(), e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.error("Failed to serialize station state", e);
        }
    }

    public int getConnectedClients() {
        return sessions.size();
    }
}
