package ru.university.assistant.content.internal;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.content.api.Attachment;
import ru.university.assistant.content.api.CreateLectureRequest;
import ru.university.assistant.content.api.ImportJob;
import ru.university.assistant.content.api.Lecture;
import ru.university.assistant.content.api.LectureDetails;
import ru.university.assistant.content.api.SaveSlideNoteRequest;
import ru.university.assistant.content.api.Slide;
import ru.university.assistant.content.api.SlideDeck;
import ru.university.assistant.content.api.SlideDeckDetails;
import ru.university.assistant.content.api.SlideNote;
import ru.university.assistant.content.api.StudentDeckApi;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class ContentService implements StudentDeckApi {
    private final CourseAccessApi courseAccess;
    private final ContentRepository repository;
    private final BlobStorage blobStorage;
    private final SlideImportWorker worker;
    private final ContentProperties properties;
    private final SignedSlideUrlService signedUrls;

    ContentService(
            CourseAccessApi courseAccess,
            ContentRepository repository,
            BlobStorage blobStorage,
            SlideImportWorker worker,
            ContentProperties properties,
            SignedSlideUrlService signedUrls) {
        this.courseAccess = courseAccess;
        this.repository = repository;
        this.blobStorage = blobStorage;
        this.worker = worker;
        this.properties = properties;
        this.signedUrls = signedUrls;
    }

    @Transactional
    public ImportJob startDeckImport(AuthenticatedUser user, UUID courseId, String title, MultipartFile file) {
        courseAccess.requireManage(user, courseId);
        if (file.isEmpty() || file.getSize() > properties.maxUploadBytes()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid upload size");
        }
        String cleanTitle = title == null || title.isBlank()
                ? filenameWithoutExtension(file.getOriginalFilename())
                : title.trim();
        try {
            validateMagic(file.getOriginalFilename(), readHeader(file), file.getSize());
            StoredBlob source = blobStorage.store(
                    file.getInputStream(), file.getOriginalFilename(), file.getContentType(), file.getSize());
            ImportJob job = repository.createJob(UuidV7.generate(), courseId, source);
            worker.process(job.id(), courseId, cleanTitle);
            return job;
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot store uploaded file", exception);
        }
    }

    public ImportJob getImportJob(AuthenticatedUser user, UUID courseId, UUID jobId) {
        courseAccess.requireVisible(user, courseId);
        return repository.findJob(courseId, jobId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Import job not found"));
    }

    public List<SlideDeck> listDecks(AuthenticatedUser user, UUID courseId) {
        courseAccess.requireVisible(user, courseId);
        return repository.listDecks(courseId);
    }

    public SlideDeckDetails getDeck(AuthenticatedUser user, UUID courseId, UUID deckId) {
        courseAccess.requireVisible(user, courseId);
        SlideDeckDetails deck = repository.findDeck(courseId, deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));
        return signDeck(deck);
    }

    @Override
    public SlideDeckDetails getDeckForStudent(UUID courseId, UUID deckId) {
        SlideDeckDetails deck = repository.findDeck(courseId, deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));
        return signDeck(deck);
    }

    public BlobResource getSlideImage(
            AuthenticatedUser user, UUID courseId, UUID deckId, int slideIndex, String token) {
        if (!signedUrls.isValid(token, courseId, deckId)) {
            if (user == null) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Signed slide URL is required");
            }
            courseAccess.requireVisible(user, courseId);
        }
        SlideRecord slide = repository.findSlideRecord(courseId, deckId, slideIndex)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found"));
        return blobStorage.resource(slide.imageRef(), "image/png");
    }

    public SlideNote saveSlideNote(
            AuthenticatedUser user, UUID courseId, UUID deckId, int slideIndex, SaveSlideNoteRequest request) {
        courseAccess.requireManage(user, courseId);
        SlideRecord slide = repository.findSlideRecord(courseId, deckId, slideIndex)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found"));
        return repository.saveNote(slide.id(), request.content().trim());
    }

    @Transactional
    public void deleteSlideNote(AuthenticatedUser user, UUID courseId, UUID deckId, int slideIndex) {
        courseAccess.requireManage(user, courseId);
        SlideRecord slide = repository.findSlideRecord(courseId, deckId, slideIndex)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found"));
        repository.deleteNote(slide.id());
    }

    @Transactional
    public void archiveDeck(AuthenticatedUser user, UUID courseId, UUID deckId) {
        courseAccess.requireManage(user, courseId);
        repository.archiveDeck(courseId, deckId);
    }

    @Transactional
    public void restoreDeck(AuthenticatedUser user, UUID courseId, UUID deckId) {
        courseAccess.requireManage(user, courseId);
        SlideDeckDetails deck = repository.findDeck(courseId, deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));
        if (repository.activeDeckVersionExists(courseId, deck.title(), deck.version(), deckId)) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Нельзя восстановить: уже есть активная презентация \""
                            + deck.title() + "\" v" + deck.version() + ".");
        }
        repository.restoreDeck(courseId, deckId);
    }

    @Transactional
    public void hardDeleteDeck(AuthenticatedUser user, UUID courseId, UUID deckId) {
        courseAccess.requireManage(user, courseId);
        SlideDeckDetails deck = repository.findDeck(courseId, deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));
        if (!deck.archived()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "Сначала отправьте презентацию в архив, потом удаляйте навсегда.");
        }
        List<String> linkedLectures = repository.lectureTitlesForDeck(deckId);
        if (!linkedLectures.isEmpty()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Презентация используется в лекциях: " + String.join(", ", linkedLectures)
                            + ". Удалите эти лекции, прежде чем удалять презентацию.");
        }
        List<String> blobRefs = repository.blobRefsForDeck(courseId, deckId);
        repository.deleteDeck(courseId, deckId);
        deleteBlobsAfterCommit(blobRefs);
    }

    public List<Lecture> listLectures(AuthenticatedUser user, UUID courseId) {
        courseAccess.requireVisible(user, courseId);
        return repository.listLectures(courseId);
    }

    @Transactional
    public Lecture createLecture(AuthenticatedUser user, UUID courseId, CreateLectureRequest request) {
        courseAccess.requireManage(user, courseId);
        ensureDeckExists(courseId, request.deckId());
        return repository.createLecture(
                UuidV7.generate(), courseId, request.title().trim(), request.deckId(), user.id());
    }

    public LectureDetails getLecture(AuthenticatedUser user, UUID courseId, UUID lectureId) {
        courseAccess.requireVisible(user, courseId);
        return repository.findLecture(courseId, lectureId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Lecture not found"));
    }

    @Transactional
    public Lecture updateLecture(AuthenticatedUser user, UUID courseId, UUID lectureId, CreateLectureRequest request) {
        courseAccess.requireManage(user, courseId);
        ensureDeckExists(courseId, request.deckId());
        return repository.updateLecture(courseId, lectureId, request.title().trim(), request.deckId());
    }

    @Transactional
    public void archiveLecture(AuthenticatedUser user, UUID courseId, UUID lectureId) {
        courseAccess.requireManage(user, courseId);
        repository.archiveLecture(courseId, lectureId);
    }

    @Transactional
    public void restoreLecture(AuthenticatedUser user, UUID courseId, UUID lectureId) {
        courseAccess.requireManage(user, courseId);
        repository.restoreLecture(courseId, lectureId);
    }

    @Transactional
    public void hardDeleteLecture(AuthenticatedUser user, UUID courseId, UUID lectureId) {
        courseAccess.requireManage(user, courseId);
        LectureDetails lecture = repository.findLecture(courseId, lectureId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Lecture not found"));
        if (!lecture.archived()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "Сначала отправьте лекцию в архив, потом удаляйте навсегда.");
        }
        repository.deleteLecture(courseId, lectureId);
    }

    @Transactional
    public Attachment addAttachment(AuthenticatedUser user, UUID courseId, UUID lectureId, MultipartFile file) {
        courseAccess.requireManage(user, courseId);
        getLecture(user, courseId, lectureId);
        if (file.isEmpty() || file.getSize() > properties.maxUploadBytes()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid upload size");
        }
        try {
            StoredBlob blob = blobStorage.store(
                    file.getInputStream(), file.getOriginalFilename(), file.getContentType(), file.getSize());
            return repository.addAttachment(UuidV7.generate(), lectureId, blob);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot store attachment", exception);
        }
    }

    @Transactional
    public void deleteAttachment(AuthenticatedUser user, UUID courseId, UUID lectureId, UUID attachmentId) {
        courseAccess.requireManage(user, courseId);
        repository.deleteAttachment(courseId, lectureId, attachmentId);
    }

    private SlideDeckDetails signDeck(SlideDeckDetails deck) {
        String token = signedUrls.token(deck.courseId(), deck.id());
        List<Slide> slides = deck.slides().stream()
                .map(slide -> new Slide(
                        slide.id(),
                        slide.deckId(),
                        slide.idx(),
                        signedUrls.slideImageUrl(deck.courseId(), deck.id(), slide.idx(), token),
                        slide.textExtract(),
                        slide.note()))
                .toList();
        return new SlideDeckDetails(
                deck.id(), deck.courseId(), deck.title(), deck.version(),
                deck.slideCount(), deck.archived(), deck.sourceFilename(), deck.createdAt(), token, slides);
    }

    private void ensureDeckExists(UUID courseId, UUID deckId) {
        if (repository.findDeck(courseId, deckId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Deck does not belong to course");
        }
    }

    private void deleteBlobsAfterCommit(List<String> refs) {
        Runnable delete = () -> {
            try {
                blobStorage.deleteAll(refs);
            } catch (IOException exception) {
                throw new UncheckedIOException("Cannot delete deck blobs", exception);
            }
        };
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            delete.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                delete.run();
            }
        });
    }

    private String filenameWithoutExtension(String filename) {
        if (filename == null || filename.isBlank()) {
            return "Материалы";
        }
        int dot = filename.lastIndexOf('.');
        return dot <= 0 ? filename : filename.substring(0, dot);
    }

    private byte[] readHeader(MultipartFile file) throws IOException {
        try (InputStream stream = file.getInputStream()) {
            return stream.readNBytes(8);
        }
    }

    private void validateMagic(String filename, byte[] header, long size) {
        if (size < 4 || header.length < 4) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Файл пустой или повреждён");
        }
        String extension = extension(filename);
        boolean pdf = startsWith(header, "%PDF".getBytes(StandardCharsets.US_ASCII));
        boolean zip = header[0] == 'P' && header[1] == 'K';
        boolean ole = header.length >= 8
                && (header[0] & 0xff) == 0xd0
                && (header[1] & 0xff) == 0xcf
                && (header[2] & 0xff) == 0x11
                && (header[3] & 0xff) == 0xe0
                && (header[4] & 0xff) == 0xa1
                && (header[5] & 0xff) == 0xb1
                && (header[6] & 0xff) == 0x1a
                && (header[7] & 0xff) == 0xe1;
        boolean supported = switch (extension) {
            case ".pdf" -> pdf;
            case ".pptx", ".odp" -> zip;
            case ".ppt" -> ole;
            default -> false;
        };
        if (!supported) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Тип файла не совпадает с содержимым. Загрузите PDF, PPT, PPTX или ODP без пароля.");
        }
    }

    private String extension(String filename) {
        if (filename == null) {
            return "";
        }
        int dot = filename.lastIndexOf('.');
        return dot < 0 ? "" : filename.substring(dot).toLowerCase(Locale.ROOT);
    }

    private boolean startsWith(byte[] bytes, byte[] prefix) {
        if (bytes.length < prefix.length) {
            return false;
        }
        for (int index = 0; index < prefix.length; index++) {
            if (bytes[index] != prefix[index]) {
                return false;
            }
        }
        return true;
    }
}
