package com.aurora.config;

import com.aurora.websocket.StationWebSocketHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final StationWebSocketHandler handler;
    private final String[] allowedOrigins;

    public WebSocketConfig(StationWebSocketHandler handler,
                           @Value("${aurora.cors.allowed-origins}") String[] allowedOrigins) {
        this.handler = handler;
        this.allowedOrigins = java.util.Arrays.stream(allowedOrigins)
            .map(String::trim)
            .filter(o -> !o.isEmpty() && !"*".equals(o))
            .toArray(String[]::new);
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/station")
                .setAllowedOrigins(allowedOrigins);
    }
}
