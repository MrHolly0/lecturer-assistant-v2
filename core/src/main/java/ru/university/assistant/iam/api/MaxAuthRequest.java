package ru.university.assistant.iam.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * linkCode — необязательный одноразовый код из {@code POST /api/v1/identity/max/link-codes}
 * (B-03): связывает этот MAX-аккаунт с уже существующей личностью (например, преподавателем)
 * вместо создания нового студента. Игнорируется, если этот MAX-аккаунт уже с кем-то связан.
 */
public record MaxAuthRequest(
        @NotBlank @Size(max = 8192) String initData, @Size(max = 32) String linkCode) {}
