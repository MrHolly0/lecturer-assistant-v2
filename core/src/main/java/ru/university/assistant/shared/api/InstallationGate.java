package ru.university.assistant.shared.api;

/** Orders session admission with a maintenance barrier held by the installation operator. */
public interface InstallationGate {
    void requireSessionAdmission();
}
