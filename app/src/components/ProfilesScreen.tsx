import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getLocalUserId } from '../lib/identity';
import { useStore } from '../lib/store';
import type { Profile } from '../lib/types';

// docs/48 D175 — the one thing that pass explicitly didn't build: any way
// to see or rename a profile beyond a direct database patch (the
// migration's own "Wife" placeholder, meant to be renamed here). A real
// gap found immediately after shipping: Settings' "Household devices"
// list and the "Household" payer list both show profiles, but neither
// lets you do anything with one.
export function ProfilesScreen() {
  const store = useStore();

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← Back</Link>
        <span className="wordmark">Household profiles</span>
        <span style={{ width: '3rem' }} />
      </div>

      {store.profiles.length === 0 ? (
        <p className="empty-note">No profiles yet — sign in to create one.</p>
      ) : (
        <div className="accounts-list">
          {store.profiles.map((p) => (
            <ProfileRow key={p.id} profile={p} />
          ))}
        </div>
      )}
    </main>
  );
}

// Local mirror of displayName, same reasoning as AccountsScreen's Name/
// Institution fields: current.displayName comes straight from the store,
// and commit() writes through an async DB round-trip (PowerSync live
// query), so binding the input's value directly to it snaps the cursor
// to the end on every keystroke once that round-trip resolves.
function ProfileRow({ profile }: { profile: Profile }) {
  const store = useStore();
  const [nameStr, setNameStr] = useState(() => profile.displayName);
  const isYou = profile.id === getLocalUserId();

  return (
    <div className="settings-field">
      <label className="field-label">
        {isYou ? 'You' : 'Household member'}
        <input
          className="text-input"
          value={nameStr}
          onChange={(e) => {
            const v = e.target.value;
            setNameStr(v);
            // A blank name would leave a profile with nothing to display
            // anywhere it's referenced (payer badges, device groups) —
            // held back locally until there's something real to save,
            // same guard AccountsScreen's own required Name field uses.
            if (v.trim()) store.updateProfile(profile.id, { displayName: v });
          }}
        />
      </label>
    </div>
  );
}
