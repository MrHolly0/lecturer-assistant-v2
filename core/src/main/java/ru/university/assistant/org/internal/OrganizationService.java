package ru.university.assistant.org.internal;

import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.InvitationApi;
import ru.university.assistant.org.api.OrganizationModels.AssignStaffRequest;
import ru.university.assistant.org.api.OrganizationModels.OrganizationMember;
import ru.university.assistant.org.api.OrganizationModels.OrganizationUnit;
import ru.university.assistant.org.api.OrganizationModels.OrganizationView;
import ru.university.assistant.org.api.OrganizationModels.SaveUnitRequest;
import ru.university.assistant.org.api.OrganizationModels.UnitRole;
import ru.university.assistant.org.api.StaffMembershipApi;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class OrganizationService implements StaffMembershipApi {
    private final OrganizationRepository repository;
    private final InvitationApi invitations;

    OrganizationService(OrganizationRepository repository, InvitationApi invitations) {
        this.repository = repository;
        this.invitations = invitations;
    }

    public OrganizationView view(AuthenticatedUser user) {
        requireStaff(user);
        var membership = repository.membership(user.id()).orElse(null);
        var manageableIds = membership == null ? java.util.Set.<UUID>of() : repository.descendants(membership.unitId());
        List<OrganizationUnit> units = repository.units().stream()
                .map(unit -> new OrganizationUnit(
                        unit.id(), unit.parentId(), unit.name(), unit.kind(), unit.directCount(), unit.totalCount(),
                        administrator(user) || (membership != null && membership.role() == UnitRole.MANAGER
                                && manageableIds.contains(unit.id())),
                        administrator(user) || (membership != null && manageableIds.contains(unit.id()))))
                .toList();
        return new OrganizationView(units, administrator(user));
    }

    public List<OrganizationMember> members(AuthenticatedUser user, UUID unitId) {
        requireStaff(user);
        UUID scope = unitId;
        if (!administrator(user)) {
            var membership = repository.membership(user.id()).orElse(null);
            if (membership == null) {
                if (unitId == null) {
                    return List.of();
                }
                throw forbidden();
            }
            scope = scope == null ? membership.unitId() : scope;
            if (!repository.descendants(membership.unitId()).contains(scope)) {
                throw forbidden();
            }
        } else if (scope != null) {
            unit(scope);
        }
        return repository.members(scope);
    }

    @Transactional
    public OrganizationUnit save(AuthenticatedUser user, UUID unitId, SaveUnitRequest request) {
        requireStaff(user);
        repository.lockStructure();
        var previous = unitId == null ? null : unit(unitId);
        if (previous != null) {
            requireManage(user, unitId);
            if (previous.kind() != request.kind()) {
                throw badRequest("Тип существующего подразделения нельзя изменить");
            }
        }
        validateParent(user, previous, request);
        UUID id = unitId == null ? UuidV7.generate() : unitId;
        try {
            repository.save(id, request.parentId(), request.name().trim(), request.kind());
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Подразделение с таким названием уже существует");
        }
        return view(user).units().stream().filter(item -> item.id().equals(id)).findFirst().orElseThrow();
    }

    private void validateParent(
            AuthenticatedUser user, OrganizationRepository.UnitRow previous, SaveUnitRequest request) {
        if (request.parentId() != null) {
            unit(request.parentId());
            if (previous != null && repository.descendants(previous.id()).contains(request.parentId())) {
                throw badRequest("Нельзя переместить группу внутрь себя или своей дочерней группы");
            }
        }
        boolean parentChanged = previous == null || !Objects.equals(previous.parentId(), request.parentId());
        if (parentChanged) {
            if (request.parentId() == null) {
                if (!administrator(user)) {
                    throw forbidden();
                }
            } else {
                requireManage(user, request.parentId());
            }
        }
        if (previous == null && request.parentId() == null && !administrator(user)) {
            throw forbidden();
        }
    }

    @Transactional
    public void delete(AuthenticatedUser user, UUID unitId) {
        requireStaff(user);
        repository.lockStructure();
        unit(unitId);
        requireManage(user, unitId);
        repository.delete(unitId);
    }

    @Transactional
    public void assign(AuthenticatedUser user, UUID personId, AssignStaffRequest request) {
        requireStaff(user);
        repository.lockStructure();
        PersonRole role = repository.personRole(personId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Сотрудник не найден"));
        if (role == PersonRole.STUDENT) {
            throw badRequest("Студенты распределяются по учебным группам курса");
        }
        if (request.unitId() != null) {
            unit(request.unitId());
            requireManage(user, request.unitId());
        }
        if (!administrator(user)) {
            requireMemberChange(user, personId, role, request);
        }
        repository.assign(personId, request.unitId(), request.unitRole());
    }

    private void requireMemberChange(
            AuthenticatedUser user, UUID personId, PersonRole role, AssignStaffRequest request) {
        var previous = repository.membership(personId).orElse(null);
        if (previous != null) {
            requireManage(user, previous.unitId());
        }
        if (previous == null || personId.equals(user.id()) || role == PersonRole.ADMIN
                || (previous != null && previous.role() == UnitRole.MANAGER)
                || request.unitRole() != UnitRole.MEMBER) {
            throw forbidden();
        }
    }

    private void requireManage(AuthenticatedUser user, UUID unitId) {
        if (administrator(user)) {
            return;
        }
        var membership = repository.membership(user.id()).orElseThrow(OrganizationService::forbidden);
        if (membership.role() != UnitRole.MANAGER || !repository.descendants(membership.unitId()).contains(unitId)) {
            throw forbidden();
        }
    }

    @Override
    @Transactional
    public void validateInvitationTarget(UUID unitId) {
        if (unitId != null) {
            repository.lockStructure();
            unit(unitId);
        }
    }

    @Override
    @Transactional
    public void addInvitedStaff(UUID personId, UUID invitationId) {
        repository.lockStructure();
        UUID unitId = invitations.organizationUnit(invitationId).orElse(null);
        if (unitId != null) {
            repository.assign(personId, unitId, UnitRole.MEMBER);
        }
    }

    @Override
    @Transactional
    public void removeStaffMembershipIfStudent(UUID personId) {
        repository.lockStructure();
        repository.assign(personId, null, UnitRole.MEMBER);
    }

    private OrganizationRepository.UnitRow unit(UUID id) {
        return repository.unit(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Подразделение не найдено"));
    }

    private static boolean administrator(AuthenticatedUser user) {
        return user.role() == PersonRole.ADMIN;
    }

    private static void requireStaff(AuthenticatedUser user) {
        if (user.role() == PersonRole.STUDENT) {
            throw forbidden();
        }
    }

    private static ResponseStatusException forbidden() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "Нет прав на это подразделение или изменение доступа");
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
