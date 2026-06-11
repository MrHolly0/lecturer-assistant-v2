package ru.university.assistant.channel.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public record DeliveryReportBatch(@Valid @NotEmpty List<DeliveryReport> reports) {}
