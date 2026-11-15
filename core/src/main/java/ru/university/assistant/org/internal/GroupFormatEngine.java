package ru.university.assistant.org.internal;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import ru.university.assistant.org.api.GroupFormatPolicy;
import ru.university.assistant.org.api.GroupFormatPreview;

/** Bounded parsing: memoized (field, position), no administrator-supplied regex or scripts. */
final class GroupFormatEngine {
    private GroupFormatEngine() {}

    static void validate(GroupFormatPolicy policy) {
        if (policy.fields() == null || policy.fields().size() > 8
                || (policy.enabled() && policy.fields().isEmpty())) throw bad("Нужно от 1 до 8 полей");
        var ids = new HashSet<String>();
        for (var field : policy.fields()) {
            if (field == null || field.id() == null
                    || !field.id().matches("[a-z][a-z0-9_]{0,31}") || !ids.add(field.id())) {
                throw bad("У полей должны быть разные идентификаторы");
            }
            if (field.label() == null || field.label().isBlank() || field.label().length() > 80
                    || field.prefix() == null || field.prefix().length() > 8) throw bad("Проверьте название поля");
            if (field.kind() == null) throw bad("Выберите тип поля");
            if (field.kind().equals("CHOICE")) {
                if (field.choices() == null || field.choices().isEmpty() || field.choices().size() > 128) {
                    throw bad("Заполните справочник вариантов");
                }
                var spellings = new HashMap<String, String>();
                for (var choice : field.choices()) {
                    if (choice == null || choice.code() == null || choice.code().isBlank()
                            || choice.code().length() > 24
                            || choice.label() == null || choice.label().length() > 160
                            || (choice.aliases() != null && choice.aliases().size() > 16)) {
                        throw bad("Проверьте обозначения вариантов");
                    }
                    for (String spelling : spellings(choice)) {
                        String old = spellings.putIfAbsent(spelling, choice.code());
                        if (spelling.isEmpty() || (old != null && !old.equals(choice.code()))) {
                            throw bad("Одинаковые обозначения у разных вариантов");
                        }
                    }
                }
                if (field.defaultValue() != null && !field.defaultValue().isEmpty()
                        && field.choices().stream().noneMatch(c -> c.code().equals(field.defaultValue()))) {
                    throw bad("Не найден вариант по умолчанию");
                }
            } else if (field.kind().equals("YEAR")) {
                if ((field.width() != 2 && field.width() != 4)
                        || field.yearBase() < 1900 || field.yearBase() > 2200 || field.yearBase() % 100 != 0) {
                    throw bad("Для года выберите 2 или 4 цифры и столетие");
                }
            } else if (field.kind().equals("NUMBER")) {
                if (field.width() < 1 || field.width() > 6) throw bad("Номер должен содержать от 1 до 6 цифр");
            } else {
                throw bad("Неизвестный тип поля");
            }
        }
    }

    static GroupFormatPreview parse(GroupFormatPolicy policy, String raw) {
        validate(policy);
        if (raw == null || raw.isBlank() || raw.length() > 160) return invalid(Map.of(), "Введите группу");
        if (!policy.enabled()) return new GroupFormatPreview(true, raw.trim(), null, Map.of(), null);
        String text = compact(raw);
        List<Map<String, String>> matches = match(policy.fields(), 0, text, 0, new HashMap<>());
        if (matches.size() == 1) return compose(policy, matches.get(0));
        if (matches.size() > 1) return invalid(Map.of(), "Название неоднозначно. Уточните поля группы");
        return invalid(partial(policy, text), "Группа не соответствует формату учреждения. Уточните поля");
    }

    static GroupFormatPreview compose(GroupFormatPolicy policy, Map<String, String> values) {
        validate(policy);
        if (!policy.enabled()) throw bad("Формат учреждения не включён");
        if (values == null || values.keySet().stream().anyMatch(id ->
                policy.fields().stream().noneMatch(f -> f.id().equals(id)))) {
            return invalid(Map.of(), "Формат изменился. Проверьте поля группы");
        }
        Map<String, String> parts = new LinkedHashMap<>();
        StringBuilder name = new StringBuilder();
        for (var field : policy.fields()) {
            String value = Objects.requireNonNullElse(values.get(field.id()), "");
            String rendered;
            if (field.kind().equals("CHOICE")) {
                String selected = value;
                var choice = field.choices().stream().filter(c -> c.code().equals(selected)).findFirst();
                if (choice.isEmpty()) return invalid(parts, "Выберите: " + field.label());
                rendered = choice.get().code();
                value = rendered;
            } else {
                if (!value.matches("[0-9]{1,6}")) return invalid(parts, "Проверьте: " + field.label());
                int number = Integer.parseInt(value);
                if (field.kind().equals("YEAR") && (number < field.yearBase()
                        || number >= field.yearBase() + 100)) return invalid(parts, "Проверьте год");
                int output = field.kind().equals("YEAR") && field.width() == 2 ? number % 100 : number;
                rendered = String.format(Locale.ROOT, "%0" + field.width() + "d", output);
                if (rendered.length() != field.width()) return invalid(parts, "Проверьте: " + field.label());
                value = Integer.toString(number);
            }
            parts.put(field.id(), value);
            name.append(field.prefix()).append(rendered);
        }
        if (name.length() > 100) return invalid(parts, "Сократите формат: название длиннее 100 символов");
        return new GroupFormatPreview(true, name.toString(), identity(parts), Map.copyOf(parts), null);
    }

    private static List<Map<String, String>> match(List<GroupFormatPolicy.Field> fields, int index,
            String input, int position, Map<String, List<Map<String, String>>> memo) {
        String key = index + ":" + position;
        if (memo.containsKey(key)) return memo.get(key);
        List<Map<String, String>> found = new ArrayList<>();
        if (index == fields.size()) {
            if (position == input.length()) found.add(Map.of());
        } else {
            var field = fields.get(index);
            String prefix = compact(field.prefix());
            if (input.startsWith(prefix, position)) {
                int offset = position + prefix.length();
                for (var token : tokens(field, input, offset)) {
                    for (var rest : match(fields, index + 1, input, offset + token.length(), memo)) {
                        Map<String, String> result = new LinkedHashMap<>(rest);
                        result.put(field.id(), token.value());
                        if (!found.contains(result)) found.add(Map.copyOf(result));
                        if (found.size() == 2) break;
                    }
                    if (found.size() == 2) break;
                }
            }
        }
        memo.put(key, found);
        return found;
    }

    private static List<Token> tokens(GroupFormatPolicy.Field field, String input, int offset) {
        List<Token> result = new ArrayList<>();
        if (field.kind().equals("CHOICE")) {
            for (var choice : field.choices()) {
                for (String spelling : spellings(choice)) {
                    if (input.startsWith(spelling, offset)) result.add(new Token(choice.code(), spelling.length()));
                }
            }
            if (field.defaultValue() != null && !field.defaultValue().isEmpty()) {
                result.add(new Token(field.defaultValue(), 0));
            }
        } else if (offset + field.width() <= input.length()) {
            String raw = input.substring(offset, offset + field.width());
            if (raw.matches("[0-9]+")) {
                int value = Integer.parseInt(raw);
                if (field.kind().equals("YEAR") && field.width() == 2) value += field.yearBase();
                result.add(new Token(Integer.toString(value), field.width()));
            }
        }
        return result;
    }

    private static Map<String, String> partial(GroupFormatPolicy policy, String input) {
        Map<String, String> result = new LinkedHashMap<>();
        int position = 0;
        for (var field : policy.fields()) {
            String prefix = compact(field.prefix());
            if (!input.startsWith(prefix, position)) break;
            position += prefix.length();
            var candidates = tokens(field, input, position).stream().distinct().toList();
            var explicit = candidates.stream().filter(t -> t.length() > 0).toList();
            if (explicit.size() == 1) {
                result.put(field.id(), explicit.get(0).value());
                position += explicit.get(0).length();
            } else if (explicit.isEmpty() && field.defaultValue() != null && !field.defaultValue().isEmpty()) {
                result.put(field.id(), field.defaultValue());
            } else break;
        }
        return result;
    }

    private static List<String> spellings(GroupFormatPolicy.Choice choice) {
        List<String> result = new ArrayList<>();
        result.add(compact(choice.code()));
        for (String alias : Objects.requireNonNullElse(choice.aliases(), List.<String>of())) {
            if (alias == null || alias.length() > 24) throw bad("Слишком длинный вариант обозначения");
            result.add(compact(alias));
        }
        return result.stream().distinct().toList();
    }

    private static String compact(String input) {
        StringBuilder result = new StringBuilder();
        Normalizer.normalize(input, Normalizer.Form.NFKC).toUpperCase(Locale.ROOT).codePoints()
                .filter(c -> !Character.isWhitespace(c) && !Character.isSpaceChar(c)
                        && Character.getType(c) != Character.DASH_PUNCTUATION && c != '_')
                .forEach(result::appendCodePoint);
        return result.toString();
    }

    private static String identity(Map<String, String> parts) {
        StringBuilder canonical = new StringBuilder();
        new TreeMap<>(parts).forEach((key, value) -> canonical.append(key.length()).append(':').append(key)
                .append('=').append(compact(value).length()).append(':').append(compact(value)).append(';'));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static GroupFormatPreview invalid(Map<String, String> parts, String message) {
        return new GroupFormatPreview(false, null, null, Map.copyOf(parts), message);
    }

    private static IllegalArgumentException bad(String message) {
        return new IllegalArgumentException(message);
    }

    private record Token(String value, int length) {}
}
