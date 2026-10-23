package ru.university.assistant.iam.internal.security;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
class RequestAdmissionConfiguration implements WebMvcConfigurer {
    private final RequestAdmissionInterceptor admission;
    RequestAdmissionConfiguration(RequestAdmissionInterceptor admission) { this.admission = admission; }
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(admission).addPathPatterns("/api/v1/**");
    }
}
