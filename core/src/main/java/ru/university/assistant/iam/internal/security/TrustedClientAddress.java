package ru.university.assistant.iam.internal.security;

import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** The managed ingress overwrites these fields; arbitrary forwarded headers have no authority. */
final class TrustedClientAddress {
    private TrustedClientAddress() {}

    static String resolve(HttpServletRequest request, String expectedKey) {
        String key = request.getHeader("X-Lecturer-Proxy-Key");
        String address = request.getHeader("X-Lecturer-Client-IP");
        if (expectedKey.length() < 32
                || key == null
                || key.length() > 128
                || address == null
                || address.length() > 45
                || !MessageDigest.isEqual(
                        expectedKey.getBytes(StandardCharsets.UTF_8),
                        key.getBytes(StandardCharsets.UTF_8))
                || !address.matches("[0-9A-Fa-f:.]+")
                || (!address.contains(":") && !address.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")))
            return request.getRemoteAddr();
        try {
            return InetAddress.getByName(address).getHostAddress();
        } catch (java.net.UnknownHostException invalid) {
            return request.getRemoteAddr();
        }
    }
}
