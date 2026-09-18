package ru.university.assistant.iam.internal;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Собирает подписанный initData по алгоритму из документации MAX (независимая от боевого кода реализация). */
public final class MaxInitDataSigner {
    private MaxInitDataSigner() {}

    public static String sign(String botToken, Map<String, String> params) {
        TreeMap<String, String> sorted = new TreeMap<>(params);
        StringBuilder launch = new StringBuilder();
        sorted.forEach((k, v) -> {
            if (launch.length() > 0) {
                launch.append('\n');
            }
            launch.append(k).append('=').append(v);
        });
        String hash = hmacHex(hmac("WebAppData".getBytes(StandardCharsets.UTF_8), botToken), launch.toString());
        StringBuilder query = new StringBuilder();
        sorted.forEach((k, v) -> query.append(encode(k)).append('=').append(encode(v)).append('&'));
        return query + "hash=" + hash;
    }

    public static String userJson(long id, String firstName, String lastName) {
        return "{\"id\":" + id + ",\"first_name\":\"" + firstName + "\",\"last_name\":\"" + lastName
                + "\",\"username\":\"u" + id + "\",\"language_code\":\"ru\"}";
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static byte[] hmac(byte[] key, String message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String hmacHex(byte[] key, String message) {
        return HexFormat.of().formatHex(hmac(key, message));
    }
}
