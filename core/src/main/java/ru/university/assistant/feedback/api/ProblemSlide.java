package ru.university.assistant.feedback.api;

/** Один слайд лекции с распределением сигналов на нём — для списка «проблемных» слайдов. */
public record ProblemSlide(int slideIdx, SignalAggregate signals) {}
