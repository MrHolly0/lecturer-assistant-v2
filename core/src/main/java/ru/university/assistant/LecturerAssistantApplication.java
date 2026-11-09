package ru.university.assistant;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableAsync
@EnableScheduling
@SpringBootApplication
public class LecturerAssistantApplication {

    public static void main(String[] args) {
        if ("content-worker".equals(System.getenv("APP_ROLE"))) {
            ru.university.assistant.content.api.ContentWorker.run(args);
            return;
        }
        SpringApplication.run(LecturerAssistantApplication.class, args);
    }
}
