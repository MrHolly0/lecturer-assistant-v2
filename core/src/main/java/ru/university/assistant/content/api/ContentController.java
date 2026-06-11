package ru.university.assistant.content.api;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import ru.university.assistant.content.internal.BlobResource;
import ru.university.assistant.content.internal.ContentService;
import ru.university.assistant.iam.api.AuthenticatedUser;

@RestController
@RequestMapping("/api/v1/courses/{courseId}")
public class ContentController {
    private final ContentService contentService;

    ContentController(ContentService contentService) {
        this.contentService = contentService;
    }

    @GetMapping("/decks")
    public List<SlideDeck> decks(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId) {
        return contentService.listDecks(user, courseId);
    }

    @PostMapping(path = "/decks", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ImportJob importDeck(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @RequestPart("title") String title,
            @RequestPart("file") MultipartFile file) {
        return contentService.startDeckImport(user, courseId, title, file);
    }

    @GetMapping("/import-jobs/{jobId}")
    public ImportJob importJob(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID jobId) {
        return contentService.getImportJob(user, courseId, jobId);
    }

    @GetMapping("/decks/{deckId}")
    public SlideDeckDetails deck(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID deckId) {
        return contentService.getDeck(user, courseId, deckId);
    }

    @GetMapping("/decks/{deckId}/slides/{slideIndex}/image")
    public ResponseEntity<FileSystemResource> slideImage(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID deckId,
            @PathVariable int slideIndex) {
        BlobResource image = contentService.getSlideImage(user, courseId, deckId, slideIndex);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(java.time.Duration.ofDays(365)).cachePublic().immutable())
                .header(HttpHeaders.CONTENT_TYPE, image.contentType())
                .body(new FileSystemResource(image.path()));
    }

    @PutMapping("/decks/{deckId}/slides/{slideIndex}/notes")
    public SlideNote saveNote(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID deckId,
            @PathVariable int slideIndex,
            @Valid @RequestBody SaveSlideNoteRequest request) {
        return contentService.saveSlideNote(user, courseId, deckId, slideIndex, request);
    }

    @GetMapping("/lectures")
    public List<Lecture> lectures(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId) {
        return contentService.listLectures(user, courseId);
    }

    @PostMapping("/lectures")
    @ResponseStatus(HttpStatus.CREATED)
    public Lecture createLecture(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @Valid @RequestBody CreateLectureRequest request) {
        return contentService.createLecture(user, courseId, request);
    }

    @GetMapping("/lectures/{lectureId}")
    public LectureDetails lecture(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID lectureId) {
        return contentService.getLecture(user, courseId, lectureId);
    }

    @PutMapping("/lectures/{lectureId}")
    public Lecture updateLecture(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID lectureId,
            @Valid @RequestBody CreateLectureRequest request) {
        return contentService.updateLecture(user, courseId, lectureId, request);
    }

    @DeleteMapping("/lectures/{lectureId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archiveLecture(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID lectureId) {
        contentService.archiveLecture(user, courseId, lectureId);
    }

    @PostMapping(path = "/lectures/{lectureId}/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Attachment uploadAttachment(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID lectureId,
            @RequestPart("file") MultipartFile file) {
        return contentService.addAttachment(user, courseId, lectureId, file);
    }
}
