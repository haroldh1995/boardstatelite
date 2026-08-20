import {
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AthenaDecisionAnswer,
  AthenaDecisionCandidate,
  AthenaDecisionRequest,
} from "../athena/decisionEngineTypes";
import { activeAthenaDecision } from "../athena/decisionEngine";
import { useFieldStore } from "../state/useFieldStore";
import { ScryfallSearch } from "./ScryfallSearch";

export function AthenaDecisionSurface() {
  const queue = useFieldStore((state) => state.field.athena.decisions);
  const answerDecision = useFieldStore((state) => state.answerAthenaDecision);
  const identifyZoneCard = useFieldStore(
    (state) => state.identifyAthenaDecisionZoneCard,
  );
  const request = activeAthenaDecision(queue);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(0);
  const [distribution, setDistribution] = useState<Record<string, number>>({});
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [manualCategory, setManualCategory] = useState("token-created");
  const [manualPower, setManualPower] = useState(1);
  const [manualToughness, setManualToughness] = useState(1);
  const [identifyingCandidateId, setIdentifyingCandidateId] = useState<
    string | null
  >(null);

  useEffect(() => {
    setSelectedIds([]);
    setQuantity(
      request?.type === "manual-result"
        ? Math.max(1, request.constraints.quantityMinimum ?? 0)
        : (request?.constraints.quantityMinimum ?? 0),
    );
    setDistribution({});
    setOrderIds(request?.candidates.map((candidate) => candidate.id) ?? []);
    setManualCategory("token-created");
    setManualPower(1);
    setManualToughness(1);
    setIdentifyingCandidateId(null);
  }, [
    request?.id,
    request?.type,
    request?.constraints.quantityMinimum,
    request?.candidates,
  ]);

  const activeCandidates = useMemo(
    () => request?.candidates.filter((candidate) => candidate.eligible) ?? [],
    [request],
  );
  if (!request) return null;
  const distributionTotal = Object.values(distribution).reduce(
    (sum, value) => sum + value,
    0,
  );
  const semanticProgress =
    request.type === "distribution" &&
    request.constraints.quantityTotal !== null
      ? `${distributionTotal} of ${request.constraints.quantityTotal} distributed.`
      : request.constraints.maximumSelections > 1
        ? `${selectedIds.length} of ${request.constraints.maximumSelections} selected.`
        : request.semanticProgress;

  function commit(answer: Partial<AthenaDecisionAnswer>) {
    answerDecision(request!.id, {
      ...answer,
      responseId: `touch:${request!.id}:${responseSignature(answer)}`,
      channel: "touch",
    });
  }

  function chooseCandidate(candidate: AthenaDecisionCandidate) {
    if (candidate.kind === "untracked-card") {
      setIdentifyingCandidateId(candidate.id);
      return;
    }
    const maximum = request!.constraints.maximumSelections;
    const exact = request!.constraints.exactSelections;
    if (maximum <= 1) {
      commit(candidateAnswer(request!, [candidate.id]));
      return;
    }
    const next = request!.constraints.allowRepeatedOptions
      ? [...selectedIds, candidate.id].slice(0, maximum)
      : selectedIds.includes(candidate.id)
        ? selectedIds.filter((id) => id !== candidate.id)
        : [...selectedIds, candidate.id].slice(0, maximum);
    setSelectedIds(next);
    if (exact !== null && next.length === exact) {
      commit(candidateAnswer(request!, next));
    }
  }

  const requiresAuthority =
    request.authorityRequired || request.status === "authority-required";
  const manual =
    request.type === "manual-result" ||
    request.type === "unsupported-rules-choice" ||
    request.status === "manual-required";

  return (
    <aside
      className="athena-decision-surface"
      aria-label="Current gameplay decision"
      data-testid="athena-decision-surface"
    >
      <header>
        <div>
          <span className="athena-decision-kicker">Choice needed</span>
          <strong>{request.prompt}</strong>
        </div>
        {(requiresAuthority || manual) && <ShieldAlert aria-hidden="true" />}
      </header>

      {(requiresAuthority || request.type === "unsupported-rules-choice") && (
        <p className="athena-decision-message" role="status">
          Open this interaction in BoardState for authoritative rules help.
        </p>
      )}

      {request.validation && !request.validation.valid && (
        <p className="athena-decision-error" role="alert">
          {request.validation.reason}
        </p>
      )}

      {manual && !requiresAuthority && (
        <div className="athena-manual-result">
          <p className="athena-decision-message" role="status">
            Resolve the physical choice, then report only the resulting
            bookkeeping.
          </p>
          <label>
            <span>Result</span>
            <select
              value={manualCategory}
              onChange={(event) => setManualCategory(event.target.value)}
            >
              <option value="token-created">Create tokens</option>
              <option value="life-gained">Gain life</option>
              <option value="life-lost">Lose life</option>
            </select>
          </label>
          {manualCategory === "token-created" && (
            <>
              <label>
                <span>Power</span>
                <input
                  type="number"
                  min={0}
                  value={manualPower}
                  onChange={(event) =>
                    setManualPower(Number(event.target.value))
                  }
                />
              </label>
              <label>
                <span>Toughness</span>
                <input
                  type="number"
                  min={0}
                  value={manualToughness}
                  onChange={(event) =>
                    setManualToughness(Number(event.target.value))
                  }
                />
              </label>
            </>
          )}
          <label>
            <span>Quantity</span>
            <input
              type="number"
              min={0}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className="athena-decision-confirm"
            disabled={
              !Number.isSafeInteger(quantity) ||
              quantity <= 0 ||
              (manualCategory === "token-created" &&
                (!Number.isSafeInteger(manualPower) ||
                  !Number.isSafeInteger(manualToughness)))
            }
            onClick={() =>
              commit({
                manualResult: {
                  eventCategory: manualCategory,
                  quantity,
                  targetGroupIds: [],
                  counterType: null,
                  tokenName:
                    manualCategory === "token-created" ? "Token" : null,
                  tokenPower:
                    manualCategory === "token-created" ? manualPower : null,
                  tokenToughness:
                    manualCategory === "token-created" ? manualToughness : null,
                  tokenCardTypes:
                    manualCategory === "token-created" ? ["Creature"] : [],
                  tokenSubtypes: [],
                  tokenColors: [],
                  tokenTapped: false,
                  tokenAttacking: false,
                  originZone: null,
                  destinationZone: null,
                },
              })
            }
          >
            <Check aria-hidden="true" /> Apply result
          </button>
        </div>
      )}

      {(request.type === "optional-effect" ||
        request.type === "optional-replacement" ||
        request.type === "yes-no") && (
        <div
          className="athena-decision-binary"
          role="group"
          aria-label={request.semanticPrompt}
        >
          <button type="button" onClick={() => commit({ accepted: true })}>
            <Check aria-hidden="true" /> Yes
          </button>
          <button type="button" onClick={() => commit({ accepted: false })}>
            <X aria-hidden="true" /> No
          </button>
        </div>
      )}

      {(request.type === "quantity" || request.type === "x-value") && (
        <div className="athena-decision-quantity">
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={() =>
              setQuantity((value) =>
                Math.max(request.constraints.quantityMinimum ?? 0, value - 1),
              )
            }
          >
            <Minus />
          </button>
          <label>
            <span>{request.type === "x-value" ? "X" : "Quantity"}</span>
            <input
              type="number"
              min={request.constraints.quantityMinimum ?? 0}
              max={request.constraints.quantityMaximum ?? undefined}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() =>
              setQuantity((value) =>
                Math.min(
                  request.constraints.quantityMaximum ??
                    Number.MAX_SAFE_INTEGER,
                  value + 1,
                ),
              )
            }
          >
            <Plus />
          </button>
          <button
            type="button"
            className="athena-decision-confirm"
            onClick={() => commit({ quantity })}
          >
            <Check aria-hidden="true" /> Confirm
          </button>
        </div>
      )}

      {request.type === "distribution" && (
        <div className="athena-decision-distribution">
          {request.constraints.quantityTotal !== null && (
            <span className="athena-decision-progress" role="status">
              {semanticProgress}
            </span>
          )}
          {activeCandidates.map((candidate) => (
            <label key={candidate.id}>
              <span>{candidate.label}</span>
              <input
                type="number"
                min={0}
                value={distribution[candidate.id] ?? 0}
                onChange={(event) =>
                  setDistribution((current) => ({
                    ...current,
                    [candidate.id]: Math.max(0, Number(event.target.value)),
                  }))
                }
              />
            </label>
          ))}
          <button
            type="button"
            className="athena-decision-confirm"
            disabled={
              request.constraints.quantityTotal !== null &&
              distributionTotal !== request.constraints.quantityTotal
            }
            onClick={() => commit({ distribution })}
          >
            <Check aria-hidden="true" /> Apply
          </button>
        </div>
      )}

      {identifyingCandidateId && (
        <div className="athena-decision-identify">
          <ScryfallSearch
            label="Identify the untracked zone card"
            actionLabel="Use This Card"
            onConfirm={(card) => {
              identifyZoneCard(request.id, identifyingCandidateId, card);
              setIdentifyingCandidateId(null);
            }}
          />
        </div>
      )}

      {(request.type === "trigger-order" ||
        request.type === "replacement-order") &&
        activeCandidates.length > 0 && (
          <div className="athena-decision-order">
            {orderIds.map((id, index) => {
              const candidate = activeCandidates.find(
                (entry) => entry.id === id,
              );
              if (!candidate) return null;
              return (
                <div key={id}>
                  <span>{candidate.label}</span>
                  <button
                    type="button"
                    aria-label={`Move ${candidate.label} earlier`}
                    disabled={index === 0}
                    onClick={() =>
                      setOrderIds(move(orderIds, index, index - 1))
                    }
                  >
                    <ChevronUp />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${candidate.label} later`}
                    disabled={index === orderIds.length - 1}
                    onClick={() =>
                      setOrderIds(move(orderIds, index, index + 1))
                    }
                  >
                    <ChevronDown />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="athena-decision-confirm"
              onClick={() => commit({ orderIds, selectedOptionIds: orderIds })}
            >
              <Check aria-hidden="true" /> Use order
            </button>
          </div>
        )}

      {!identifyingCandidateId &&
        showsCandidateChoices(request) &&
        activeCandidates.length > 0 && (
          <>
            {request.constraints.maximumSelections > 1 && (
              <span className="athena-decision-progress" role="status">
                {semanticProgress}
              </span>
            )}
            <div
              className="athena-decision-options"
              role="group"
              aria-label={request.semanticPrompt}
            >
              {activeCandidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.id}
                  className={
                    selectedIds.includes(candidate.id) ? "selected" : ""
                  }
                  aria-pressed={selectedIds.includes(candidate.id)}
                  onClick={() => chooseCandidate(candidate)}
                >
                  {candidate.label}
                </button>
              ))}
            </div>
          </>
        )}

      {!identifyingCandidateId &&
        showsCandidateChoices(request) &&
        request.constraints.maximumSelections > 1 &&
        request.constraints.exactSelections === null && (
          <button
            type="button"
            className="athena-decision-confirm"
            disabled={
              selectedIds.length < request.constraints.minimumSelections
            }
            onClick={() => commit(candidateAnswer(request, selectedIds))}
          >
            <Check aria-hidden="true" /> Confirm {selectedIds.length}
          </button>
        )}

      {!identifyingCandidateId &&
        showsCandidateChoices(request) &&
        request.constraints.allowRepeatedOptions &&
        selectedIds.length > 0 && (
          <button
            type="button"
            aria-label="Clear selected options"
            onClick={() => setSelectedIds([])}
          >
            <X aria-hidden="true" /> Clear
          </button>
        )}

      {!requiresAuthority && !manual && (
        <span className="sr-only" aria-live="polite">
          {request.semanticPrompt} {semanticProgress}
        </span>
      )}
    </aside>
  );
}

function candidateAnswer(
  request: AthenaDecisionRequest,
  ids: string[],
): Partial<AthenaDecisionAnswer> {
  const candidates = ids
    .map((id) => request.candidates.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is AthenaDecisionCandidate =>
      Boolean(candidate),
    );
  const groupIds = candidates.flatMap((candidate) =>
    candidate.groupId ? [candidate.groupId] : [],
  );
  const labels = candidates.map((candidate) => candidate.label);
  return {
    selectedOptionIds: ids,
    targetGroupIds: groupIds,
    selectedGroupIds: groupIds,
    mode: request.type === "mode-selection" ? labels[0] : null,
    modes: request.type === "multi-mode-selection" ? labels : [],
    color: request.type === "color-selection" ? labels[0] : null,
    cardType: request.type === "card-type-selection" ? labels[0] : null,
    creatureType: request.type === "creature-type-selection" ? labels[0] : null,
    counterType: request.type === "counter-type-selection" ? labels[0] : null,
  };
}

function showsCandidateChoices(request: AthenaDecisionRequest): boolean {
  return [
    "target-selection",
    "multi-target-selection",
    "mode-selection",
    "multi-mode-selection",
    "color-selection",
    "card-type-selection",
    "creature-type-selection",
    "counter-type-selection",
    "object-selection",
    "card-selection",
    "zone-card-selection",
  ].includes(request.type);
}

function move(values: string[], from: number, to: number): string[] {
  if (to < 0 || to >= values.length) return values;
  const next = [...values];
  const [value] = next.splice(from, 1);
  if (value) next.splice(to, 0, value);
  return next;
}

function responseSignature(answer: Partial<AthenaDecisionAnswer>): string {
  return JSON.stringify(answer);
}
