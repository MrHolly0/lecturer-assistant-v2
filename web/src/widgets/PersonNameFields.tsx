import type { PersonName } from "../shared/lib/personName";

export function PersonNameFields({
  value,
  onChange,
  disabled
}: {
  value: PersonName;
  onChange: (value: PersonName) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="registration-name" disabled={disabled}>
      <legend>ФИО</legend>
      <label className="field">
        <span>Фамилия</span>
        <input
          name="familyName"
          value={value.familyName}
          onChange={(event) => onChange({ ...value, familyName: event.target.value })}
          required
          maxLength={100}
          autoComplete="family-name"
        />
      </label>
      <label className="field">
        <span>Имя</span>
        <input
          name="givenName"
          value={value.givenName}
          onChange={(event) => onChange({ ...value, givenName: event.target.value })}
          required
          maxLength={100}
          autoComplete="given-name"
        />
      </label>
      <label className="field">
        <span>
          Отчество <span className="muted">(если есть)</span>
        </span>
        <input
          name="middleName"
          value={value.middleName}
          onChange={(event) => onChange({ ...value, middleName: event.target.value })}
          maxLength={100}
          autoComplete="additional-name"
        />
      </label>
    </fieldset>
  );
}
