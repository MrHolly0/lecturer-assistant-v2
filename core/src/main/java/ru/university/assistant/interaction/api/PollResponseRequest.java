package ru.university.assistant.interaction.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

public record PollResponseRequest(
        String participantToken,
        @Min(0) Integer optionIdx,
        @Size(max = 2000) String textAnswer) {
    public PollResponseRequest(String participantToken, Integer optionIdx) {
        this(participantToken, optionIdx, null);
    }
}
