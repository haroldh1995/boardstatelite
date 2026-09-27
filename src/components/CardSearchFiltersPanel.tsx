import { RotateCcw } from "lucide-react";
import {
  CARD_COLORS,
  CARD_KEYWORDS,
  CARD_SUPERTYPES,
  CARD_TYPES,
  createDefaultCardSearchFilters,
  type CardSearchFilters,
} from "../domain/cardSearch";

export function CardSearchFiltersPanel({
  filters,
  onChange,
}: {
  filters: CardSearchFilters;
  onChange: (filters: CardSearchFilters) => void;
}) {
  const update = <Key extends keyof CardSearchFilters>(
    key: Key,
    value: CardSearchFilters[Key],
  ) => onChange({ ...filters, [key]: value });

  return (
    <section className="card-search-filters" aria-label="Advanced card filters">
      <div className="search-filter-heading">
        <strong>Advanced Search</strong>
        <button
          type="button"
          className="quiet-action"
          onClick={() => onChange(createDefaultCardSearchFilters())}
        >
          <RotateCcw aria-hidden="true" /> Clear Filters
        </button>
      </div>

      <div className="search-filter-grid">
        <label>
          Card Name
          <input
            value={filters.cardName}
            onChange={(event) => update("cardName", event.target.value)}
          />
        </label>
        <label>
          Subtype
          <input
            value={filters.subtype}
            placeholder="Dragon, Goblin, Equipment"
            onChange={(event) => update("subtype", event.target.value)}
          />
        </label>
      </div>

      <FilterChips
        label="Card Type"
        options={CARD_TYPES.map((value) => ({ value, label: value }))}
        selected={filters.cardTypes}
        onChange={(value) => update("cardTypes", value)}
      />
      <FilterChips
        label="Supertype"
        options={CARD_SUPERTYPES.map((value) => ({ value, label: value }))}
        selected={filters.supertypes}
        onChange={(value) => update("supertypes", value)}
      />
      <FilterChips
        label="Color"
        options={[...CARD_COLORS]}
        selected={filters.colors}
        onChange={(value) => update("colors", value)}
      />
      <FilterChips
        label="Color Identity"
        options={[...CARD_COLORS]}
        selected={filters.colorIdentity}
        onChange={(value) => update("colorIdentity", value)}
      />

      <div className="search-filter-grid search-filter-mana">
        <label>
          Mana Value
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={filters.manaValue ?? ""}
            onChange={(event) =>
              update(
                "manaValue",
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
          />
        </label>
        <label>
          Mana Match
          <select
            value={filters.manaValueOperator}
            onChange={(event) =>
              update(
                "manaValueOperator",
                event.target.value as CardSearchFilters["manaValueOperator"],
              )
            }
          >
            <option value="exact">Exactly</option>
            <option value="at-most">At most</option>
            <option value="at-least">At least</option>
          </select>
        </label>
        <label>
          Mana Cost
          <input
            value={filters.manaCost}
            placeholder="2UU"
            onChange={(event) => update("manaCost", event.target.value)}
          />
        </label>
      </div>

      <label>
        Oracle / Rules Text
        <input
          value={filters.oracleText}
          placeholder="draw cards"
          onChange={(event) => update("oracleText", event.target.value)}
        />
      </label>

      <div className="search-filter-grid">
        <label>
          Power
          <input
            value={filters.power}
            inputMode="numeric"
            onChange={(event) => update("power", event.target.value)}
          />
        </label>
        <label>
          Toughness
          <input
            value={filters.toughness}
            inputMode="numeric"
            onChange={(event) => update("toughness", event.target.value)}
          />
        </label>
        <label>
          Keyword
          <select
            value={filters.keywords[0] ?? ""}
            onChange={(event) =>
              update("keywords", event.target.value ? [event.target.value] : [])
            }
          >
            <option value="">Any keyword</option>
            {CARD_KEYWORDS.map((keyword) => (
              <option key={keyword} value={keyword}>
                {keyword}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rarity
          <select
            value={filters.rarity}
            onChange={(event) => update("rarity", event.target.value)}
          >
            <option value="">Any rarity</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="mythic">Mythic Rare</option>
          </select>
        </label>
        <label>
          Set
          <input
            value={filters.set}
            placeholder="Code or name"
            onChange={(event) => update("set", event.target.value)}
          />
        </label>
        <label>
          Artist
          <input
            value={filters.artist}
            onChange={(event) => update("artist", event.target.value)}
          />
        </label>
      </div>

      <FilterChips
        label="Commander Identity Compatibility"
        options={[...CARD_COLORS].filter((entry) => entry.value !== "C")}
        selected={filters.commanderColorIdentity}
        onChange={(value) => update("commanderColorIdentity", value)}
      />
    </section>
  );
}

function FilterChips({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset className="search-filter-chips">
      <legend>{label}</legend>
      <div>
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              type="button"
              key={option.value}
              className={active ? "selected" : ""}
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((value) => value !== option.value)
                    : [...selected, option.value],
                )
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
