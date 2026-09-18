-- Канал MAX для внешних идентичностей, участников лекции, сигналов, вопросов и очереди доставки.
-- Заодно приводим список каналов участника лекции к остальным таблицам (там уже есть echo, D-26).
ALTER TABLE iam.channel_identities DROP CONSTRAINT channel_identities_channel_type_check;
ALTER TABLE iam.channel_identities
    ADD CONSTRAINT channel_identities_channel_type_check
    CHECK (channel_type IN ('telegram', 'vk', 'web', 'echo', 'max'));

ALTER TABLE live.session_participants DROP CONSTRAINT session_participants_channel_type_check;
ALTER TABLE live.session_participants
    ADD CONSTRAINT session_participants_channel_type_check
    CHECK (channel_type IN ('web', 'telegram', 'vk', 'echo', 'max'));

ALTER TABLE feedback.comprehension_signals DROP CONSTRAINT comprehension_signals_channel_type_check;
ALTER TABLE feedback.comprehension_signals
    ADD CONSTRAINT comprehension_signals_channel_type_check
    CHECK (channel_type IN ('web', 'telegram', 'vk', 'echo', 'max'));

ALTER TABLE qa.questions DROP CONSTRAINT questions_channel_type_check;
ALTER TABLE qa.questions
    ADD CONSTRAINT questions_channel_type_check
    CHECK (channel_type IN ('web', 'telegram', 'vk', 'echo', 'max'));

ALTER TABLE channel.channel_capabilities DROP CONSTRAINT channel_capabilities_channel_type_check;
ALTER TABLE channel.channel_capabilities
    ADD CONSTRAINT channel_capabilities_channel_type_check
    CHECK (channel_type IN ('telegram', 'vk', 'web', 'echo', 'max'));

ALTER TABLE channel.outbox DROP CONSTRAINT outbox_channel_type_check;
ALTER TABLE channel.outbox
    ADD CONSTRAINT outbox_channel_type_check
    CHECK (channel_type IN ('telegram', 'vk', 'web', 'echo', 'max'));

ALTER TABLE channel.delivery_reports DROP CONSTRAINT delivery_reports_channel_type_check;
ALTER TABLE channel.delivery_reports
    ADD CONSTRAINT delivery_reports_channel_type_check
    CHECK (channel_type IN ('telegram', 'vk', 'web', 'echo', 'max'));
