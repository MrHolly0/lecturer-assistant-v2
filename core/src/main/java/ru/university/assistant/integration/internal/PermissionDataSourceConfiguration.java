package ru.university.assistant.integration.internal;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.core.Ordered;
import org.springframework.jdbc.datasource.lookup.AbstractRoutingDataSource;
import org.springframework.web.filter.OncePerRequestFilter;

/** Permission renewal must not queue behind transactions waiting on a poll/session write lock. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(DataSourceProperties.class)
@ConditionalOnProperty(name = "app.integration.enabled", havingValue = "true")
class PermissionDataSourceConfiguration {
    private static final ThreadLocal<Boolean> PERMISSION_READ = new ThreadLocal<>();
    private static final Set<String> READ_PATHS = Set.of(
            "/internal/v1/realtime/student-grant", "/internal/v1/realtime/student-batch",
            "/internal/v1/realtime/presenter-grant", "/internal/v1/realtime/public-snapshot",
            "/internal/v1/media/authorize");

    @Bean(destroyMethod = "close")
    @ConfigurationProperties("spring.datasource.hikari")
    HikariDataSource applicationDataSource(DataSourceProperties properties) {
        return properties.initializeDataSourceBuilder().type(HikariDataSource.class).build();
    }

    @Bean(destroyMethod = "close")
    HikariDataSource permissionDataSource(DataSourceProperties properties,
            @Value("${app.integration.permission-pool-size:4}") int maximum) {
        if (maximum < 1 || maximum > 16) throw new IllegalArgumentException("Invalid permission pool size");
        HikariDataSource pool = properties.initializeDataSourceBuilder().type(HikariDataSource.class).build();
        pool.setPoolName("permission-checks");
        pool.setMaximumPoolSize(maximum); pool.setMinimumIdle(0);
        pool.setConnectionTimeout(1000); pool.setValidationTimeout(1000);
        pool.setReadOnly(true);
        pool.setConnectionInitSql("set default_transaction_read_only=on");
        pool.addDataSourceProperty("options", "-c statement_timeout=2000 -c lock_timeout=500");
        return pool;
    }

    @Bean(name = "dataSource")
    @Primary
    DataSource routingDataSource(@Qualifier("applicationDataSource") DataSource application,
            @Qualifier("permissionDataSource") DataSource permission) {
        AbstractRoutingDataSource routing = new AbstractRoutingDataSource() {
            @Override protected Object determineCurrentLookupKey() {
                return Boolean.TRUE.equals(PERMISSION_READ.get()) ? "permission" : "application";
            }
        };
        routing.setTargetDataSources(Map.of("application", application, "permission", permission));
        routing.setDefaultTargetDataSource(application);
        routing.afterPropertiesSet();
        return routing;
    }

    @Bean
    FilterRegistrationBean<OncePerRequestFilter> permissionReadRouting() {
        OncePerRequestFilter filter = new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                    FilterChain chain) throws ServletException, IOException {
                boolean read = "POST".equals(request.getMethod()) && READ_PATHS.contains(request.getRequestURI());
                if (read) PERMISSION_READ.set(true);
                try { chain.doFilter(request, response); }
                finally { PERMISSION_READ.remove(); }
            }
        };
        var registration = new FilterRegistrationBean<>(filter);
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        registration.addUrlPatterns("/internal/v1/*");
        return registration;
    }
}
