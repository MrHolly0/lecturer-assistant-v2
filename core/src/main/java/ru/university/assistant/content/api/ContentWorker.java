package ru.university.assistant.content.api;

/** Entry point for the independently deployed import worker. */
public final class ContentWorker {
    private ContentWorker() {}
    public static void run(String[] args) {
        ru.university.assistant.content.internal.ContentWorkerApplication.run(args);
    }
}
