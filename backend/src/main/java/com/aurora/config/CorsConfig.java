package com.aurora.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

/**
 * CORS restricted to the configured origins (aurora.cors.allowed-origins,
 * env ALLOWED_ORIGINS). Wildcards are never allowed.
 */
@Configuration
public class CorsConfig {

    @Value("${aurora.cors.allowed-origins}")
    private List<String> allowedOrigins;

    @Bean
    public CorsFilter corsFilter() {
        CorsConfiguration config = new CorsConfiguration();
        allowedOrigins.stream()
            .map(String::trim)
            .filter(o -> !o.isEmpty() && !"*".equals(o))
            .forEach(config::addAllowedOrigin);
        config.addAllowedMethod("GET");
        config.addAllowedMethod("POST");
        config.addAllowedHeader("Content-Type");
        config.setAllowCredentials(false);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return new CorsFilter(source);
    }
}
