package ru.university.assistant.org.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import ru.university.assistant.org.api.GroupFormatPolicy;
import ru.university.assistant.org.api.GroupFormatPolicy.Choice;
import ru.university.assistant.org.api.GroupFormatPolicy.Field;

class GroupFormatEngineTest {
    static GroupFormatPolicy example() {
        return new GroupFormatPolicy(1, true, List.of(
                new Field("level", "Уровень", "CHOICE", "", 0, 0, "б",
                        List.of(new Choice("б", "Бакалавриат", List.of("b")),
                                new Choice("м", "Магистратура", List.of()))),
                new Field("program", "Направление", "CHOICE", "", 0, 0, null,
                        List.of(new Choice("ИСТ", "Информационные системы и технологии", List.of("IST")))),
                new Field("year", "Год поступления", "YEAR", "-", 2, 2000, null, List.of()),
                new Field("number", "Номер группы", "NUMBER", "", 1, 0, null, List.of())));
    }

    @Test
    void acceptedSpellingsShareIdentityWithoutCollapsingDegreeLevels() {
        String key = null;
        for (String input : List.of("бИСТ-234", "БИСТ-234", "ИСТ-234", "бИСТ234", "БИСТ234",
                "ИСТ234", " б ИСТ — 23 4 ", "bIST_234")) {
            var parsed = GroupFormatEngine.parse(example(), input);
            assertTrue(parsed.valid(), input);
            assertEquals("бИСТ-234", parsed.name());
            assertEquals("2023", parsed.parts().get("year"));
            assertEquals("4", parsed.parts().get("number"));
            if (key == null) key = parsed.identityKey();
            assertEquals(key, parsed.identityKey());
        }
        assertNotEquals(key, GroupFormatEngine.parse(example(), "мИСТ-234").identityKey());
    }

    @Test
    void failedTextOffersRecognizedFieldsAndStructuredFormCanFinishIt() {
        var failed = GroupFormatEngine.parse(example(), "бИСТ-");
        assertFalse(failed.valid());
        assertEquals("ИСТ", failed.parts().get("program"));
        var completed = GroupFormatEngine.compose(example(),
                Map.of("level", "б", "program", "ИСТ", "year", "2023", "number", "4"));
        assertTrue(completed.valid());
        assertEquals("бИСТ-234", completed.name());
        assertFalse(GroupFormatEngine.parse(example(), "что-то непонятное").valid());
        assertFalse(GroupFormatEngine.parse(example(), "бИСТ-23").valid());
    }

    @Test
    void anotherInstitutionCanChangeFieldOrderWidthsAndSeparators() {
        var policy = new GroupFormatPolicy(2, true, List.of(
                new Field("year", "Год", "YEAR", "", 4, 2000, null, List.of()),
                new Field("number", "Класс", "NUMBER", "/", 2, 0, null, List.of())));
        var parsed = GroupFormatEngine.parse(policy, "2023/04");
        assertTrue(parsed.valid());
        assertEquals("2023/04", parsed.name());
        assertEquals("4", parsed.parts().get("number"));
    }

    @Test
    void ambiguityRequiresExplicitFieldsInsteadOfGuessing() {
        var policy = new GroupFormatPolicy(1, true, List.of(
                new Field("a", "Первое", "CHOICE", "", 0, 0, null,
                        List.of(new Choice("A", "A", List.of()), new Choice("AB", "AB", List.of()))),
                new Field("b", "Второе", "CHOICE", "", 0, 0, null,
                        List.of(new Choice("BC", "BC", List.of()), new Choice("C", "C", List.of())))));
        assertFalse(GroupFormatEngine.parse(policy, "ABC").valid());
        assertTrue(GroupFormatEngine.compose(policy, Map.of("a", "A", "b", "BC")).valid());
    }

    @Test
    void disabledPolicyPreservesLegacyNamesAndBadPoliciesAreRejected() {
        assertEquals("Любое старое название", GroupFormatEngine.parse(
                new GroupFormatPolicy(0, false, List.of()), "Любое старое название").name());
        assertThrows(IllegalArgumentException.class,
                () -> GroupFormatEngine.validate(new GroupFormatPolicy(1, true, List.of())));
        assertFalse(GroupFormatEngine.compose(example(),
                Map.of("level", "б", "program", "ИСТ", "year", "3023", "number", "4")).valid());
        assertFalse(GroupFormatEngine.compose(example(), Map.of("unknown", "123")).valid());
    }
}
