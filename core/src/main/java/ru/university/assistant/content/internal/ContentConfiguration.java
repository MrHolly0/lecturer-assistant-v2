package ru.university.assistant.content.internal;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
@EnableConfigurationProperties(ContentProperties.class)
class ContentConfiguration {
    @Bean(name = "contentImportExecutor")
    ThreadPoolTaskExecutor contentImportExecutor(ContentProperties properties) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(properties.importCorePoolSize());
        executor.setMaxPoolSize(properties.importMaxPoolSize());
        executor.setQueueCapacity(properties.importQueueCapacity());
        executor.setThreadNamePrefix("content-import-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.initialize();
        return executor;
    }
}
