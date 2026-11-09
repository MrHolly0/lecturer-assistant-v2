package ru.university.assistant.content.internal;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.EnableScheduling;

/** A dedicated process: no IAM, live controllers, realtime broker, or unrelated schedulers. */
@Configuration
@Profile("content-worker")
@EnableAutoConfiguration
@EnableScheduling
@Import({ContentConfiguration.class, ContentRepository.class, FsBlobStorage.class,
    SlideImportWorker.class, ContentImportRecovery.class})
public class ContentWorkerApplication {
    public static void run(String[] args) {
        SpringApplication application = new SpringApplication(ContentWorkerApplication.class);
        application.setAdditionalProfiles("content-worker");
        application.setDefaultProperties(java.util.Map.of("spring.flyway.enabled", "false"));
        application.run(args);
    }
}
