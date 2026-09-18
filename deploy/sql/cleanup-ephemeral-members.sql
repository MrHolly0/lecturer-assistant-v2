-- D-14: убрать временных гостей, которых старый код записывал в постоянный состав курсов.
-- Сами записи гостей (persons, сигналы, вопросы, ответы) не трогаются, чтобы не терять данные лекций;
-- их можно отличить по iam.persons.status = 'EPHEMERAL'. Метрики пилота считаем по реальным людям
-- (status = 'ACTIVE') либо явно разделяем по этому признаку.
-- Скрипт идемпотентен. Запуск: psql "$DB_URL" -f deploy/sql/cleanup-ephemeral-members.sql

DELETE FROM org.group_members gm
USING iam.persons p
WHERE gm.person_id = p.id AND p.status = 'EPHEMERAL';

DELETE FROM org.course_members cm
USING iam.persons p
WHERE cm.person_id = p.id AND p.status = 'EPHEMERAL';
