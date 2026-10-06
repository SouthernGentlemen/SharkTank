// Cosmetics: display name + skin. Edits are held as a local DRAFT and only committed on
// Confirm; Exit discards them. Skins are a radio group (keyboard-operable, announced);
// each option shows a swatch AND its name, so color is never the only cue (WCAG 1.4.1).

import { useState } from "react";
import { SKINS } from "../../engine/index.js";
import { isFamilyFriendlyName, sanitizeDisplayName } from "../../protocol/index.js";

export function Customize({
  name,
  skin,
  onConfirm,
  onExit,
}: {
  name: string;
  skin: string;
  onConfirm: (name: string, skin: string) => void;
  onExit: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftSkin, setDraftSkin] = useState(skin);
  const dirty = draftName !== name || draftSkin !== skin;
  // Judge what the server will actually store, not what was typed. This used to check the
  // raw draft while Confirm committed the sanitised string, so the gate and the saved value
  // could disagree — a draft could be accepted here and land as something else, or be
  // refused here despite sanitising to a perfectly good name.
  const trimmedName = draftName.trim();
  const storedName = sanitizeDisplayName(draftName);
  const nameRejected = trimmedName.length > 0 && trimmedName !== storedName && storedName === "Player";
  const validName = !nameRejected && isFamilyFriendlyName(storedName);

  return (
    <div className="center-screen">
      <div className="panel stack customize-panel">
        <h1 className="screen-title">Customize</h1>

        <div className="field">
          <label htmlFor="cz-name">Display name</label>
          <input
            id="cz-name"
            className="input"
            value={draftName}
            maxLength={16}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Player"
            autoComplete="off"
            aria-invalid={!validName}
            aria-describedby={!validName ? "cz-name-error" : undefined}
          />
          {!validName && <span id="cz-name-error" role="alert" className="field-error">That name can&rsquo;t be used. Try letters and numbers.</span>}
        </div>

        <fieldset className="skin-fieldset">
          <legend className="skin-legend">Skin</legend>
          <div role="radiogroup" aria-label="Shark skin" className="skin-grid">
            {SKINS.map((s) => {
              const selected = s.id === draftSkin;
              return (
                <label key={s.id} className={selected ? "skin-option is-selected" : "skin-option"}>
                  <input type="radio" name="skin" checked={selected} onChange={() => setDraftSkin(s.id)} className="sr-only" />
                  <svg className="skin-preview" viewBox="0 0 56 56" aria-hidden="true">
                    <defs>
                      <linearGradient id={`skin-preview-${s.id}`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor={s.color} />
                        <stop offset="1" stopColor={s.accent ?? s.color} />
                      </linearGradient>
                    </defs>
                    <circle cx="28" cy="28" r="28" fill={`url(#skin-preview-${s.id})`} />
                  </svg>
                  <span className="font-strong">{s.name}</span>
                  {selected && <span className="sr-only">(selected)</span>}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="row row--end">
          <button className="btn" onClick={onExit}>Exit</button>
          <button className="btn btn--primary" onClick={() => onConfirm(storedName, draftSkin)} disabled={!dirty || !validName}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
