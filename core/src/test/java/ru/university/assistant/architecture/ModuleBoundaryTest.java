package ru.university.assistant.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.fields;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.Map;
import java.util.Set;

@AnalyzeClasses(packages = "ru.university.assistant", importOptions = ImportOption.DoNotIncludeTests.class)
class ModuleBoundaryTest {

    private static final Set<String> MODULES = Set.of(
            "iam",
            "org",
            "content",
            "live",
            "qa",
            "feedback",
            "interaction",
            "channel",
            "analytics",
            "shared");

    @ArchTest
    static final ArchRule modules_must_not_depend_on_other_modules_internal_packages =
            classes()
                    .that()
                    .resideInAPackage("ru.university.assistant..")
                    .should(notAccessAnotherModuleInternalPackage());

    @ArchTest
    static final ArchRule core_must_not_import_channel_sdks = noClasses()
            .that()
            .resideInAPackage("ru.university.assistant..")
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage(
                    "org.telegram..",
                    "org.telegram.telegrambots..",
                    "com.pengrad.telegrambot..",
                    "com.vk..",
                    "api.longpoll..");

    @ArchTest
    static final ArchRule core_must_not_keep_domain_state_in_static_maps = fields()
            .that()
            .haveRawType(Map.class)
            .should()
            .notBeStatic()
            .allowEmptyShould(true);

    @ArchTest
    static void modules_are_declared(JavaClasses classes) {
        for (String module : MODULES) {
            boolean exists = classes.stream()
                    .map(JavaClass::getPackageName)
                    .anyMatch(packageName -> packageName.startsWith("ru.university.assistant." + module));

            if (!exists) {
                throw new AssertionError("Missing module package: " + module);
            }
        }
    }

    private static ArchCondition<JavaClass> notAccessAnotherModuleInternalPackage() {
        return new ArchCondition<>("not access another module internal package") {
            @Override
            public void check(JavaClass item, ConditionEvents events) {
                String sourceModule = moduleOf(item.getPackageName());
                item.getDirectDependenciesFromSelf().stream()
                        .map(dependency -> dependency.getTargetClass().getPackageName())
                        .filter(targetPackage -> targetPackage.startsWith("ru.university.assistant."))
                        .filter(targetPackage -> targetPackage.contains(".internal"))
                        .forEach(targetPackage -> {
                            String targetModule = moduleOf(targetPackage);
                            if (targetModule != null && !targetModule.equals(sourceModule)) {
                                String message = item.getName() + " depends on " + targetPackage;
                                events.add(SimpleConditionEvent.violated(item, message));
                            }
                        });
            }
        };
    }

    private static String moduleOf(String packageName) {
        for (String module : MODULES) {
            if (packageName.startsWith("ru.university.assistant." + module)) {
                return module;
            }
        }
        return null;
    }
}
