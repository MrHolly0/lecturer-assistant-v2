package ru.university.assistant.interaction.internal.gift;

import java.util.ArrayList;
import java.util.List;

/**
 * Recursive-descent parser for the Moodle GIFT format.
 *
 * <p>Grammar (simplified):
 * <pre>
 * file       := question*
 * question   := title? text '{' answers '}'
 * title      := '::' TEXT '::'
 * answers    := choice_list | tf_answer | short_answers
 * choice_list:= answer_item+
 * answer_item:= ('=' | '~') TEXT ('#' FEEDBACK)?
 * tf_answer  := ('TRUE' | 'FALSE' | 'T' | 'F')
 * short_answers := answer_item+  (all '=')
 * </pre>
 */
public class GiftParser {

    public List<GiftQuestion> parse(String input) {
        List<GiftQuestion> result = new ArrayList<>();
        Tokenizer tokenizer = new Tokenizer(input);
        while (tokenizer.hasMore()) {
            tokenizer.skipBlankLines();
            if (!tokenizer.hasMore()) break;
            GiftQuestion q = parseQuestion(tokenizer);
            if (q != null) {
                result.add(q);
            }
        }
        return result;
    }

    private GiftQuestion parseQuestion(Tokenizer t) {
        String title = null;
        if (t.peek("::")) {
            title = t.readTitle();
        }
        String text = t.readUntil('{').trim();
        if (!t.consume('{')) return null;
        t.skipWhitespace();
        List<GiftAnswer> answers = parseAnswers(t);
        t.consume('}');
        if (text.isEmpty() && title != null) {
            text = title;
        }
        GiftQuestionType type = detectType(answers);
        return new GiftQuestion(title, text, type, answers);
    }

    private List<GiftAnswer> parseAnswers(Tokenizer t) {
        List<GiftAnswer> answers = new ArrayList<>();
        t.skipWhitespace();

        // TRUE/FALSE
        String tfToken = t.peekWord();
        if ("TRUE".equalsIgnoreCase(tfToken) || "T".equalsIgnoreCase(tfToken)) {
            t.skipWord();
            answers.add(new GiftAnswer("TRUE", true, null));
            answers.add(new GiftAnswer("FALSE", false, null));
            return answers;
        }
        if ("FALSE".equalsIgnoreCase(tfToken) || "F".equalsIgnoreCase(tfToken)) {
            t.skipWord();
            answers.add(new GiftAnswer("TRUE", false, null));
            answers.add(new GiftAnswer("FALSE", true, null));
            return answers;
        }

        // Choice / Short-answer
        while (t.hasMore() && !t.peek("}")) {
            t.skipWhitespace();
            if (t.peek("}")) break;
            boolean correct = false;
            if (t.consume("=")) {
                correct = true;
            } else if (t.consume("~")) {
                correct = false;
            } else {
                break;
            }
            String answerText = t.readUntilAny(new char[]{'#', '=', '~', '}'}).trim();
            String feedback = null;
            if (t.consume("#")) {
                feedback = t.readUntilAny(new char[]{'=', '~', '}'}).trim();
            }
            answers.add(new GiftAnswer(answerText, correct, feedback));
            t.skipWhitespace();
        }
        return answers;
    }

    private GiftQuestionType detectType(List<GiftAnswer> answers) {
        if (answers.size() == 2) {
            boolean hasTrueFalse = answers.stream()
                    .map(GiftAnswer::text)
                    .allMatch(t -> "TRUE".equalsIgnoreCase(t) || "FALSE".equalsIgnoreCase(t));
            if (hasTrueFalse) return GiftQuestionType.TRUE_FALSE;
        }
        long correctCount = answers.stream().filter(GiftAnswer::correct).count();
        if (correctCount > 1) return GiftQuestionType.MULTIPLE_CHOICE;
        if (correctCount == 1 && answers.size() == 1) return GiftQuestionType.SHORT_ANSWER;
        if (answers.isEmpty()) return GiftQuestionType.SHORT_ANSWER;
        return GiftQuestionType.CHOICE;
    }

    private static class Tokenizer {
        private final String src;
        private int pos;

        Tokenizer(String src) {
            this.src = src.replace("\r\n", "\n").replace("\r", "\n");
            this.pos = 0;
        }

        boolean hasMore() {
            return pos < src.length();
        }

        void skipBlankLines() {
            while (pos < src.length()) {
                int nl = src.indexOf('\n', pos);
                if (nl == -1) {
                    if (src.substring(pos).isBlank()) pos = src.length();
                    break;
                }
                String line = src.substring(pos, nl);
                if (line.isBlank() || line.startsWith("//")) {
                    pos = nl + 1;
                } else {
                    break;
                }
            }
        }

        void skipWhitespace() {
            while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) {
                pos++;
            }
        }

        boolean peek(String token) {
            return src.startsWith(token, pos);
        }

        boolean peek(String token, int offset) {
            return src.startsWith(token, pos + offset);
        }

        boolean consume(String token) {
            if (src.startsWith(token, pos)) {
                pos += token.length();
                return true;
            }
            return false;
        }

        boolean consume(char ch) {
            if (pos < src.length() && src.charAt(pos) == ch) {
                pos++;
                return true;
            }
            return false;
        }

        String peekWord() {
            int end = pos;
            while (end < src.length() && Character.isLetter(src.charAt(end))) {
                end++;
            }
            return src.substring(pos, end);
        }

        void skipWord() {
            while (pos < src.length() && Character.isLetter(src.charAt(pos))) {
                pos++;
            }
        }

        String readTitle() {
            // consume leading '::'
            pos += 2;
            int end = src.indexOf("::", pos);
            if (end == -1) {
                String rest = src.substring(pos).trim();
                pos = src.length();
                return rest;
            }
            String title = src.substring(pos, end).trim();
            pos = end + 2;
            return title;
        }

        String readUntil(char stop) {
            int start = pos;
            while (pos < src.length() && src.charAt(pos) != stop) {
                pos++;
            }
            return src.substring(start, pos);
        }

        String readUntilAny(char[] stops) {
            int start = pos;
            outer:
            while (pos < src.length()) {
                char ch = src.charAt(pos);
                for (char stop : stops) {
                    if (ch == stop) break outer;
                }
                pos++;
            }
            return src.substring(start, pos);
        }
    }
}
