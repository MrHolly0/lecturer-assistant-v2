FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace/core

# Цели сборки вызываются напрямую, без фаз test-compile и test: при обычном
# `package -DskipTests` Maven всё равно качает test-scope зависимости
# (testcontainers, archunit, byte-buddy), а `dependency:go-offline` вдобавок
# тянет плагины spotless, checkstyle, surefire — 257 МБ против нужных ~90.
ARG MVN_GOALS="resources:resources compiler:compile jar:jar spring-boot:repackage"

# Слой зависимостей: те же цели на пустых исходниках. Пересобирается только
# при изменении pom.xml.
COPY core/pom.xml pom.xml
RUN mvn -B -q ${MVN_GOALS} -Dspring-boot.repackage.skip=true && rm -rf target

COPY core/src src
RUN mvn -B -o ${MVN_GOALS}

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/core/target/core-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
