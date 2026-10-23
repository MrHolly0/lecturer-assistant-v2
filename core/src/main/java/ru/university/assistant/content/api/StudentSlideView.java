package ru.university.assistant.content.api;

/** Only the requested slide; teacher notes and the rest of the deck never enter student snapshots. */
public record StudentSlideView(int slideCount, Slide slide) {}
