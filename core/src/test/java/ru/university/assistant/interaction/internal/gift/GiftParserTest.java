package ru.university.assistant.interaction.internal.gift;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class GiftParserTest {
    private final GiftParser parser = new GiftParser();

    @Test
    void parseSingleChoiceQuestion() {
        String gift = """
                What colour is the sky?
                {
                    =Blue
                    ~Red
                    ~Green
                }
                """;
        List<GiftQuestion> questions = parser.parse(gift);
        assertThat(questions).hasSize(1);
        GiftQuestion q = questions.get(0);
        assertThat(q.text()).isEqualTo("What colour is the sky?");
        assertThat(q.type()).isEqualTo(GiftQuestionType.CHOICE);
        assertThat(q.answers()).hasSize(3);
        assertThat(q.answers().get(0).correct()).isTrue();
        assertThat(q.answers().get(0).text()).isEqualTo("Blue");
        assertThat(q.answers().get(1).correct()).isFalse();
        assertThat(q.answers().get(2).correct()).isFalse();
    }

    @Test
    void parseTrueFalseQuestion() {
        String gift = """
                ::Sun shines::
                The sun is a star. {TRUE}
                """;
        List<GiftQuestion> questions = parser.parse(gift);
        assertThat(questions).hasSize(1);
        GiftQuestion q = questions.get(0);
        assertThat(q.title()).isEqualTo("Sun shines");
        assertThat(q.type()).isEqualTo(GiftQuestionType.TRUE_FALSE);
        assertThat(q.answers().get(0).correct()).isTrue();  // TRUE is correct
        assertThat(q.answers().get(1).correct()).isFalse(); // FALSE is incorrect
    }

    @Test
    void parseFalseQuestion() {
        String gift = """
                The moon is a star. {FALSE}
                """;
        List<GiftQuestion> questions = parser.parse(gift);
        GiftQuestion q = questions.get(0);
        assertThat(q.type()).isEqualTo(GiftQuestionType.TRUE_FALSE);
        assertThat(q.answers().get(0).correct()).isFalse(); // TRUE is wrong
        assertThat(q.answers().get(1).correct()).isTrue();  // FALSE is correct
    }

    @Test
    void parseShortAnswerQuestion() {
        String gift = """
                What is the capital of France? {=Paris}
                """;
        List<GiftQuestion> questions = parser.parse(gift);
        GiftQuestion q = questions.get(0);
        assertThat(q.type()).isEqualTo(GiftQuestionType.SHORT_ANSWER);
        assertThat(q.answers()).hasSize(1);
        assertThat(q.answers().get(0).text()).isEqualTo("Paris");
        assertThat(q.answers().get(0).correct()).isTrue();
    }

    @Test
    void parseMultipleChoiceQuestion() {
        String gift = """
                Which are prime numbers?
                {
                    =2
                    =3
                    ~4
                    =5
                }
                """;
        List<GiftQuestion> questions = parser.parse(gift);
        GiftQuestion q = questions.get(0);
        assertThat(q.type()).isEqualTo(GiftQuestionType.MULTIPLE_CHOICE);
        assertThat(q.answers().stream().filter(GiftAnswer::correct)).hasSize(3);
    }

    @Test
    void parseAnswerWithFeedback() {
        String gift = """
                Capital of Germany?
                {
                    =Berlin#Correct!
                    ~Munich#That's Bavaria
                    ~Hamburg#That's a port city
                }
                """;
        List<GiftQuestion> questions = parser.parse(gift);
        GiftQuestion q = questions.get(0);
        assertThat(q.answers().get(0).feedback()).isEqualTo("Correct!");
        assertThat(q.answers().get(1).feedback()).isEqualTo("That's Bavaria");
    }

    @Test
    void parseMultipleQuestions() {
        String gift = """
                Q1 {=A ~B}

                Q2 {=X ~Y ~Z}
                """;
        List<GiftQuestion> questions = parser.parse(gift);
        assertThat(questions).hasSize(2);
        assertThat(questions.get(0).text()).isEqualTo("Q1");
        assertThat(questions.get(1).text()).isEqualTo("Q2");
    }

    @Test
    void skipsCommentLines() {
        String gift = """
                // This is a comment
                What is 2+2?{=4 ~3 ~5}
                """;
        List<GiftQuestion> questions = parser.parse(gift);
        assertThat(questions).hasSize(1);
    }

    @Test
    void emptyInputReturnsEmptyList() {
        assertThat(parser.parse("")).isEmpty();
        assertThat(parser.parse("   \n  ")).isEmpty();
    }
}
