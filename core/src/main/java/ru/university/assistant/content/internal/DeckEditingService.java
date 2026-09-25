package ru.university.assistant.content.internal;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.content.api.DeckEditResult;
import ru.university.assistant.content.api.ReorderSlidesRequest;
import ru.university.assistant.content.api.Slide;
import ru.university.assistant.content.api.SlideDeckDetails;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class DeckEditingService {
    private final CourseAccessApi courseAccess;
    private final ContentRepository repository;
    private final BlobStorage blobStorage;
    private final SignedSlideUrlService signedUrls;

    DeckEditingService(
            CourseAccessApi courseAccess,
            ContentRepository repository,
            BlobStorage blobStorage,
            SignedSlideUrlService signedUrls) {
        this.courseAccess = courseAccess;
        this.repository = repository;
        this.blobStorage = blobStorage;
        this.signedUrls = signedUrls;
    }

    @Transactional
    public DeckEditResult deleteSlide(AuthenticatedUser user, UUID courseId, UUID deckId, UUID slideId) {
        courseAccess.requireManage(user, courseId);
        lockDeck(courseId, deckId);
        SlideDeckDetails source = requireDeck(courseId, deckId);
        List<EditableSlideRecord> sourceSlides = repository.listEditableSlides(deckId);
        if (sourceSlides.size() <= 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Cannot delete the only slide");
        }
        if (sourceSlides.stream().noneMatch(slide -> slide.id().equals(slideId))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Slide not found");
        }
        EditTarget target = editTarget(courseId, source, sourceSlides);
        UUID targetSlideId = target.slideIds().get(slideId);
        String imageRef = repository.deleteSlide(target.deckId(), targetSlideId);
        List<UUID> remaining = repository.listEditableSlides(target.deckId()).stream()
                .map(EditableSlideRecord::id)
                .toList();
        repository.reorderSlides(target.deckId(), remaining);
        if (!target.copyOnWrite() && !repository.blobRefIsUsed(imageRef)) {
            deleteBlobsAfterCommit(List.of(imageRef));
        }
        return editResult(courseId, source.id(), target);
    }

    @Transactional
    public DeckEditResult reorderSlides(
            AuthenticatedUser user, UUID courseId, UUID deckId, ReorderSlidesRequest request) {
        courseAccess.requireManage(user, courseId);
        lockDeck(courseId, deckId);
        SlideDeckDetails source = requireDeck(courseId, deckId);
        List<EditableSlideRecord> sourceSlides = repository.listEditableSlides(deckId);
        List<UUID> requested = request.slideIds();
        Set<UUID> currentIds = sourceSlides.stream()
                .map(EditableSlideRecord::id)
                .collect(java.util.stream.Collectors.toSet());
        if (requested.size() != sourceSlides.size()
                || new HashSet<>(requested).size() != requested.size()
                || !currentIds.equals(new HashSet<>(requested))) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "slideIds must contain every slide exactly once");
        }
        EditTarget target = editTarget(courseId, source, sourceSlides);
        List<UUID> targetOrder = requested.stream().map(target.slideIds()::get).toList();
        repository.reorderSlides(target.deckId(), targetOrder);
        return editResult(courseId, source.id(), target);
    }

    private SlideDeckDetails requireDeck(UUID courseId, UUID deckId) {
        return repository.findDeck(courseId, deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));
    }

    private void lockDeck(UUID courseId, UUID deckId) {
        if (!repository.lockDeck(courseId, deckId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found");
        }
    }

    private EditTarget editTarget(UUID courseId, SlideDeckDetails source, List<EditableSlideRecord> sourceSlides) {
        if (repository.deckHasActiveSessions(source.id())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Cannot edit a deck used by an active session");
        }
        if (!source.archived() && !repository.deckHasSessionHistory(source.id())) {
            Map<UUID, UUID> unchangedIds = new LinkedHashMap<>();
            sourceSlides.forEach(slide -> unchangedIds.put(slide.id(), slide.id()));
            return new EditTarget(source.id(), false, unchangedIds);
        }

        UUID newDeckId = UuidV7.generate();
        int version = repository.nextDeckVersion(courseId, source.title());
        repository.copyDeck(source.id(), newDeckId, version);
        Map<UUID, UUID> copiedIds = new LinkedHashMap<>();
        for (EditableSlideRecord slide : sourceSlides) {
            UUID newSlideId = UuidV7.generate();
            repository.copySlide(newSlideId, newDeckId, slide);
            copiedIds.put(slide.id(), newSlideId);
        }
        repository.relinkLectures(source.id(), newDeckId);
        return new EditTarget(newDeckId, true, copiedIds);
    }

    private DeckEditResult editResult(UUID courseId, UUID sourceDeckId, EditTarget target) {
        SlideDeckDetails result = requireDeck(courseId, target.deckId());
        return new DeckEditResult(signDeck(result), target.copyOnWrite(), sourceDeckId);
    }

    private SlideDeckDetails signDeck(SlideDeckDetails deck) {
        String token = signedUrls.token(deck.courseId(), deck.id());
        List<Slide> slides = deck.slides().stream()
                .map(slide -> new Slide(
                        slide.id(),
                        slide.deckId(),
                        slide.idx(),
                        signedUrls.slideImageUrl(deck.courseId(), deck.id(), slide.id(), slide.idx(), token),
                        slide.textExtract(),
                        slide.note()))
                .toList();
        return new SlideDeckDetails(
                deck.id(),
                deck.courseId(),
                deck.title(),
                deck.version(),
                deck.slideCount(),
                deck.archived(),
                deck.sourceFilename(),
                deck.createdAt(),
                token,
                slides);
    }

    private void deleteBlobsAfterCommit(List<String> refs) {
        Runnable delete = () -> {
            try {
                blobStorage.deleteAll(refs);
            } catch (IOException exception) {
                throw new UncheckedIOException("Cannot delete slide blob", exception);
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

    private record EditTarget(UUID deckId, boolean copyOnWrite, Map<UUID, UUID> slideIds) {}
}
