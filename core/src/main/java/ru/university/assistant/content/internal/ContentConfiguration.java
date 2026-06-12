package ru.university.assistant.content.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.client.RestClient;

@Configuration
@EnableConfigurationProperties(ContentProperties.class)
class ContentConfiguration {

    // Выбор клиента конвертера определяется здесь, а не аннотациями на @Component:
    // @ConditionalOnMissingBean надёжен только на @Bean-методах @Configuration, где
    // порядок обработки детерминирован. На @Component он зависел от порядка сканирования
    // и без converter-url не создавался ни один бин → контекст падал.
    @Bean
    @ConditionalOnProperty(prefix = "app.content", name = "converter-url")
    SlideConversionClient httpSlideConversionClient(
            BlobStorage blobStorage,
            ContentProperties properties,
            RestClient.Builder builder,
            ObjectMapper objectMapper) {
        return new HttpSlideConversionClient(blobStorage, properties, builder, objectMapper);
    }

    @Bean
    @ConditionalOnMissingBean(SlideConversionClient.class)
    SlideConversionClient placeholderSlideConversionClient(BlobStorage blobStorage) {
        return new PlaceholderSlideConversionClient(blobStorage);
    }

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
