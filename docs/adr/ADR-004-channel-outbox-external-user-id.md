# ADR-004: externalUserId в internal Channel SPI

Контекст: §5.1 описывает `OutboundMessage` с `channelIdentityId`, но внешний адаптер не имеет доступа к БД core и не может по UUID узнать chatId/vkId.

Решение: internal endpoint `GET /internal/v1/channels/{type}/outbox` возвращает дополнительно `externalUserId`.

Модель домена не меняется: внешний ID по-прежнему хранится только в `iam.channel_identities`.

`channel.outbox` не дублирует внешний ID; значение подставляется join-ом при poll.

Адаптер остаётся тупым транспортом и не получает прав на чтение доменных таблиц.

Это не открывает внешний ID наружу пользователям: endpoint защищён `X-Internal-Api-Key`.

Альтернатива с отдельным resolve endpoint отброшена как лишний round-trip на каждое сообщение.

Решение нужно до Telegram/VK, иначе SPI непригоден для реальной доставки.
