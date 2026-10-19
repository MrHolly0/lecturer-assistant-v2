package ru.university.assistant.projection.api;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.channel.api.ChannelFanoutApi;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.MediaViewingAccessApi;
import ru.university.assistant.projection.internal.ShareService;

@RestController
public class ShareFrameChatController {
    private final MediaViewingAccessApi viewing;
    private final ShareService shares;
    private final ChannelFanoutApi channels;

    ShareFrameChatController(MediaViewingAccessApi viewing, ShareService shares, ChannelFanoutApi channels) {
        this.viewing = viewing;
        this.shares = shares;
        this.channels = channels;
    }

    @PostMapping("/api/v1/student/sessions/{joinCode}/screen-share/frame/chat")
    public ResponseEntity<Void> send(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable String joinCode,
            @RequestHeader(value = "X-Participant-Token", required = false) String participantToken) {
        MediaViewingAccessApi.ViewerAccess access = viewing.requireViewer(joinCode, user, participantToken);
        if (user != null && !user.id().equals(access.personId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Подключение принадлежит другому аккаунту");
        }
        ShareService.ChatFrame frame = shares.currentFrameForChat(access);
        if (frame == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Свежего кадра пока нет. Дождитесь демонстрации без паузы и повторите");
        }
        channels.sendFrameToStudent(access.session().id(), access.personId(),
                frame.shareId(), frame.receivedAt(), frame.bytes());
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).build();
    }
}
