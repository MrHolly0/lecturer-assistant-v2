package ru.university.assistant.content.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.content.api.Attachment;
import ru.university.assistant.content.api.ImportJob;
import ru.university.assistant.content.api.ImportJobStatus;
import ru.university.assistant.content.api.Lecture;
import ru.university.assistant.content.api.LectureDetails;
import ru.university.assistant.content.api.Slide;
import ru.university.assistant.content.api.SlideDeck;
import ru.university.assistant.content.api.SlideDeckDetails;
import ru.university.assistant.content.api.SlideNote;

@Repository
class ContentRepository {
    private final JdbcClient jdbc;

    ContentRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    ImportJob createJob(UUID id, UUID courseId, StoredBlob source) {
        return jdbc.sql(
                        """
                        insert into content.import_jobs (id, course_id, status, progress, source_file_ref,
                            source_filename, source_content_type, source_size_bytes)
                        values (:id, :courseId, 'PENDING', 0, :ref, :filename, :contentType, :sizeBytes)
                        returning id, course_id, deck_id, status, progress, source_filename, error_message,
                            created_at, updated_at
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .param("ref", source.ref())
                .param("filename", source.filename())
                .param("contentType", source.contentType())
                .param("sizeBytes", source.sizeBytes())
                .query(this::mapJob)
                .single();
    }

    Optional<ImportJob> findJob(UUID courseId, UUID jobId) {
        return jdbc.sql(
                        """
                        select id, course_id, deck_id, status, progress, source_filename, error_message,
                            created_at, updated_at
                        from content.import_jobs
                        where course_id = :courseId and id = :jobId
                        """)
                .param("courseId", courseId)
                .param("jobId", jobId)
                .query(this::mapJob)
                .optional();
    }

    Optional<StoredBlob> findJobSource(UUID jobId) {
        return jdbc.sql(
                        """
                        select source_file_ref, source_filename, source_content_type, source_size_bytes
                        from content.import_jobs
                        where id = :jobId
                        """)
                .param("jobId", jobId)
                .query((rs, row) -> new StoredBlob(
                        rs.getString("source_file_ref"),
                        rs.getString("source_filename"),
                        rs.getString("source_content_type"),
                        rs.getLong("source_size_bytes")))
                .optional();
    }

    void markJob(UUID jobId, ImportJobStatus status, int progress, String errorMessage, UUID deckId) {
        jdbc.sql(
                        """
                        update content.import_jobs
                        set status = :status, progress = :progress, error_message = :errorMessage,
                            deck_id = coalesce(:deckId, deck_id), updated_at = now()
                        where id = :jobId
                        """)
                .param("jobId", jobId)
                .param("status", status.name())
                .param("progress", progress)
                .param("errorMessage", errorMessage)
                .param("deckId", deckId)
                .update();
    }

    int nextDeckVersion(UUID courseId, String title) {
        Integer maxVersion = jdbc.sql(
                        """
                        select coalesce(max(version), 0)
                        from content.slide_decks
                        where course_id = :courseId and title = :title
                        """)
                .param("courseId", courseId)
                .param("title", title)
                .query(Integer.class)
                .single();
        return maxVersion + 1;
    }

    DeckRecord createDeck(UUID deckId, UUID courseId, String title, int version, StoredBlob source, UUID jobId) {
        return jdbc.sql(
                        """
                        insert into content.slide_decks (id, course_id, title, version, source_file_ref,
                            source_filename, source_content_type, source_size_bytes, import_job_id)
                        values (:id, :courseId, :title, :version, :ref, :filename, :contentType, :sizeBytes, :jobId)
                        returning id, course_id, title, version
                        """)
                .param("id", deckId)
                .param("courseId", courseId)
                .param("title", title)
                .param("version", version)
                .param("ref", source.ref())
                .param("filename", source.filename())
                .param("contentType", source.contentType())
                .param("sizeBytes", source.sizeBytes())
                .param("jobId", jobId)
                .query(this::mapDeckRecord)
                .single();
    }

    void addSlide(UUID slideId, UUID deckId, ConvertedSlide slide) {
        jdbc.sql(
                        """
                        insert into content.slides (id, deck_id, idx, image_ref, text_extract)
                        values (:id, :deckId, :idx, :imageRef, :textExtract)
                        """)
                .param("id", slideId)
                .param("deckId", deckId)
                .param("idx", slide.index())
                .param("imageRef", slide.imageRef())
                .param("textExtract", slide.textExtract())
                .update();
    }

    List<SlideDeck> listDecks(UUID courseId) {
        return jdbc.sql(
                        """
                        select d.id, d.course_id, d.title, d.version, d.source_filename, d.created_at,
                            count(s.id)::int as slide_count
                        from content.slide_decks d
                        left join content.slides s on s.deck_id = d.id
                        where d.course_id = :courseId
                        group by d.id
                        order by d.created_at desc
                        """)
                .param("courseId", courseId)
                .query(this::mapDeck)
                .list();
    }

    Optional<SlideDeckDetails> findDeck(UUID courseId, UUID deckId) {
        Optional<SlideDeck> deck = jdbc.sql(
                        """
                        select d.id, d.course_id, d.title, d.version, d.source_filename, d.created_at,
                            count(s.id)::int as slide_count
                        from content.slide_decks d
                        left join content.slides s on s.deck_id = d.id
                        where d.course_id = :courseId and d.id = :deckId
                        group by d.id
                        """)
                .param("courseId", courseId)
                .param("deckId", deckId)
                .query(this::mapDeck)
                .optional();
        return deck.map(value -> new SlideDeckDetails(
                value.id(), value.courseId(), value.title(), value.version(),
                value.sourceFilename(), value.createdAt(), listSlides(value.courseId(), deckId)));
    }

    List<Slide> listSlides(UUID courseId, UUID deckId) {
        return jdbc.sql(
                        """
                        select s.id, s.deck_id, s.idx, s.text_extract,
                            n.text as note_text, n.updated_at as note_updated_at
                        from content.slides s
                        left join content.slide_notes n on n.slide_id = s.id
                        where s.deck_id = :deckId
                        order by s.idx
                        """)
                .param("deckId", deckId)
                .query((rs, rowNumber) -> mapSlide(rs, rowNumber, courseId))
                .list();
    }

    Optional<SlideRecord> findSlideRecord(UUID courseId, UUID deckId, int index) {
        return jdbc.sql(
                        """
                        select s.id, s.deck_id, s.idx, s.image_ref, s.text_extract
                        from content.slides s
                        join content.slide_decks d on d.id = s.deck_id
                        where d.course_id = :courseId and d.id = :deckId and s.idx = :idx
                        """)
                .param("courseId", courseId)
                .param("deckId", deckId)
                .param("idx", index)
                .query(this::mapSlideRecord)
                .optional();
    }

    SlideNote saveNote(UUID slideId, String text) {
        return jdbc.sql(
                        """
                        insert into content.slide_notes (slide_id, text)
                        values (:slideId, :text)
                        on conflict (slide_id) do update set text = excluded.text, updated_at = now()
                        returning slide_id, text, updated_at
                        """)
                .param("slideId", slideId)
                .param("text", text)
                .query(this::mapNote)
                .single();
    }

    List<Lecture> listLectures(UUID courseId) {
        return jdbc.sql(
                        """
                        select id, course_id, title, deck_id, archived, created_at
                        from live.lectures
                        where course_id = :courseId
                        order by created_at desc
                        """)
                .param("courseId", courseId)
                .query(this::mapLecture)
                .list();
    }

    Lecture createLecture(UUID id, UUID courseId, String title, UUID deckId, UUID createdBy) {
        return jdbc.sql(
                        """
                        insert into live.lectures (id, course_id, title, deck_id, created_by)
                        values (:id, :courseId, :title, :deckId, :createdBy)
                        returning id, course_id, title, deck_id, archived, created_at
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .param("title", title)
                .param("deckId", deckId)
                .param("createdBy", createdBy)
                .query(this::mapLecture)
                .single();
    }

    Optional<LectureDetails> findLecture(UUID courseId, UUID lectureId) {
        return jdbc.sql(
                        """
                        select id, course_id, title, deck_id, archived, created_at
                        from live.lectures
                        where course_id = :courseId and id = :lectureId
                        """)
                .param("courseId", courseId)
                .param("lectureId", lectureId)
                .query(this::mapLecture)
                .optional()
                .map(lecture -> new LectureDetails(lecture.id(), lecture.courseId(), lecture.title(),
                        lecture.deckId(), lecture.archived(), lecture.createdAt(), listAttachments(lecture.id())));
    }

    Lecture updateLecture(UUID courseId, UUID lectureId, String title, UUID deckId) {
        return jdbc.sql(
                        """
                        update live.lectures
                        set title = :title, deck_id = :deckId
                        where course_id = :courseId and id = :lectureId
                        returning id, course_id, title, deck_id, archived, created_at
                        """)
                .param("courseId", courseId)
                .param("lectureId", lectureId)
                .param("title", title)
                .param("deckId", deckId)
                .query(this::mapLecture)
                .single();
    }

    void archiveLecture(UUID courseId, UUID lectureId) {
        jdbc.sql(
                        """
                        update live.lectures
                        set archived = true
                        where course_id = :courseId and id = :lectureId
                        """)
                .param("courseId", courseId)
                .param("lectureId", lectureId)
                .update();
    }

    Attachment addAttachment(UUID id, UUID lectureId, StoredBlob blob) {
        return jdbc.sql(
                        """
                        insert into content.attachments (id, lecture_id, file_ref, filename, content_type, size_bytes)
                        values (:id, :lectureId, :ref, :filename, :contentType, :sizeBytes)
                        returning id, lecture_id, filename, content_type, size_bytes, created_at
                        """)
                .param("id", id)
                .param("lectureId", lectureId)
                .param("ref", blob.ref())
                .param("filename", blob.filename())
                .param("contentType", blob.contentType())
                .param("sizeBytes", blob.sizeBytes())
                .query(this::mapAttachment)
                .single();
    }

    List<Attachment> listAttachments(UUID lectureId) {
        return jdbc.sql(
                        """
                        select id, lecture_id, filename, content_type, size_bytes, created_at
                        from content.attachments
                        where lecture_id = :lectureId
                        order by created_at
                        """)
                .param("lectureId", lectureId)
                .query(this::mapAttachment)
                .list();
    }

    private ImportJob mapJob(ResultSet rs, int rowNumber) throws SQLException {
        return new ImportJob(
                rs.getObject("id", UUID.class),
                rs.getObject("course_id", UUID.class),
                rs.getObject("deck_id", UUID.class),
                ImportJobStatus.valueOf(rs.getString("status")),
                rs.getInt("progress"),
                rs.getString("source_filename"),
                rs.getString("error_message"),
                instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private DeckRecord mapDeckRecord(ResultSet rs, int rowNumber) throws SQLException {
        return new DeckRecord(rs.getObject("id", UUID.class), rs.getObject("course_id", UUID.class),
                rs.getString("title"), rs.getInt("version"));
    }

    private SlideDeck mapDeck(ResultSet rs, int rowNumber) throws SQLException {
        return new SlideDeck(
                rs.getObject("id", UUID.class),
                rs.getObject("course_id", UUID.class),
                rs.getString("title"),
                rs.getInt("version"),
                rs.getInt("slide_count"),
                rs.getString("source_filename"),
                instant(rs, "created_at"));
    }

    private Slide mapSlide(ResultSet rs, int rowNumber, UUID courseId) throws SQLException {
        SlideNote note = rs.getString("note_text") == null
                ? null
                : new SlideNote(
                        rs.getObject("id", UUID.class),
                        rs.getString("note_text"),
                        instant(rs, "note_updated_at"));
        UUID deckId = rs.getObject("deck_id", UUID.class);
        int index = rs.getInt("idx");
        String imageUrl = "/api/v1/courses/" + courseId + "/decks/" + deckId + "/slides/" + index + "/image";
        return new Slide(
                rs.getObject("id", UUID.class), deckId, index, imageUrl, rs.getString("text_extract"), note);
    }

    private SlideRecord mapSlideRecord(ResultSet rs, int rowNumber) throws SQLException {
        return new SlideRecord(rs.getObject("id", UUID.class), rs.getObject("deck_id", UUID.class),
                rs.getInt("idx"), rs.getString("image_ref"), rs.getString("text_extract"));
    }

    private SlideNote mapNote(ResultSet rs, int rowNumber) throws SQLException {
        return new SlideNote(rs.getObject("slide_id", UUID.class), rs.getString("text"), instant(rs, "updated_at"));
    }

    private Lecture mapLecture(ResultSet rs, int rowNumber) throws SQLException {
        return new Lecture(
                rs.getObject("id", UUID.class),
                rs.getObject("course_id", UUID.class),
                rs.getString("title"),
                rs.getObject("deck_id", UUID.class),
                rs.getBoolean("archived"),
                instant(rs, "created_at"));
    }

    private Attachment mapAttachment(ResultSet rs, int rowNumber) throws SQLException {
        return new Attachment(
                rs.getObject("id", UUID.class),
                rs.getObject("lecture_id", UUID.class),
                rs.getString("filename"),
                rs.getString("content_type"),
                rs.getLong("size_bytes"),
                instant(rs, "created_at"));
    }

    private Instant instant(ResultSet rs, String column) throws SQLException {
        return rs.getTimestamp(column).toInstant();
    }
}
