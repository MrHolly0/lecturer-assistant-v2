package ru.university.assistant.shared.api;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

class OriginListTest {

    @Test
    void splitsTrimsAndDropsBlankEntries() {
        assertEquals(
                List.of("http://localhost:3000", "http://localhost:5173"),
                OriginList.parse(" http://localhost:3000 , http://localhost:5173 ,, "));
    }

    @Test
    void handlesEmptyInput() {
        assertEquals(List.of(), OriginList.parse(null));
        assertEquals(List.of(), OriginList.parse(""));
    }
}
