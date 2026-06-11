package ru.university.assistant.content.internal;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(ContentProperties.class)
class ContentConfiguration {}
