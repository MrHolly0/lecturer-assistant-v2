package ru.university.assistant.content.internal;

import java.io.IOException;
import java.io.UncheckedIOException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@ConditionalOnProperty(name = "app.role", havingValue = "core", matchIfMissing = true)
class BlobBudgetInitializer {
    private final BlobBudget budget;
    private final BlobStorage storage;
    private final TransactionTemplate transactions;

    BlobBudgetInitializer(
            BlobBudget budget, BlobStorage storage, TransactionTemplate transactions) {
        this.budget = budget;
        this.storage = storage;
        this.transactions = transactions;
    }

    @EventListener(ApplicationReadyEvent.class)
    void initialize() {
        transactions.executeWithoutResult(
                status -> {
                    try {
                        budget.initialize(storage.root());
                    } catch (IOException failure) {
                        throw new UncheckedIOException(failure);
                    }
                });
    }
}
