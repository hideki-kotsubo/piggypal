import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { revokeDevice, useAuthAccount, useVerifiedProfileId } from '../lib/auth';
import { formatTimeAgo, nowUtc } from '../lib/format';
import { getDeviceId, getLocalUserId } from '../lib/identity';
import { useOnline } from '../lib/syncNow';
import { useStore } from '../lib/store';
import type { Device, Profile } from '../lib/types';
import { PayerBadge } from './PayerBadge';
import { PinResetNotice } from './PinScreen';

// docs/71 — one place to manage who's in the household and which devices
// they use, replacing Settings' separate "Household profiles" screen
// (docs/48 D175), read-only "Household devices" list (D179) and members
// list (docs/38). Signed-in only: profiles and devices only exist on the
// synced tier (docs/48).
//
// Deliberately absent: renaming or moving *another* device. A device's
// own row is rewritten from its local label and identity every time it
// connects (store.tsx's touchDevice), so a remote edit would be silently
// undone. Rename a device from that device's own Settings.
export function HouseholdScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const [authAccount] = useAuthAccount();
  const online = useOnline();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const localId = getLocalUserId();
  const active = store.profiles
    .filter((p) => !p.deletedAt)
    .sort((a, b) => (a.id === localId ? -1 : b.id === localId ? 1 : a.displayName.localeCompare(b.displayName)));
  const removed = store.profiles.filter((p) => p.deletedAt);
  const profileIds = new Set(store.profiles.map((p) => p.id));
  const unlinked = store.devices.filter((d) => !profileIds.has(d.profileId));
  const devicesOf = (profileId: string) =>
    store.devices.filter((d) => d.profileId === profileId).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  // D253: revoke first (online, can fail), then drop the row through the
  // normal upload path — never the other way round, or a failed revoke
  // would leave a still-signed-in device hidden from this list.
  async function removeDevices(devices: Device[]): Promise<boolean> {
    setError(null);
    try {
      for (const d of devices) await revokeDevice(d.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('household.signOutFailed'));
      return false;
    }
    for (const d of devices) store.removeDevice(d.id);
    return true;
  }

  async function handleRemoveDevice(device: Device) {
    if (!window.confirm(t('household.confirmRemoveDevice', { label: device.label }))) return;
    await removeDevices([device]);
  }

  // D252: removing a person signs out every device they use, then
  // soft-deletes the profile. Their transactions and accounts are left
  // exactly as they are and keep showing their name, marked "(removed)".
  async function handleRemovePerson(profile: Profile) {
    const devices = devicesOf(profile.id);
    const deviceNote = devices.length > 0 ? t('household.devicesSignedOut', { count: devices.length }) : '';
    if (!window.confirm(t('household.confirmRemovePerson', { name: profile.displayName, deviceNote })))
      return;
    if (!(await removeDevices(devices))) return;
    store.updateProfile(profile.id, { deletedAt: nowUtc() });
  }

  // D254: a person can exist before they have a device (a partner who
  // doesn't use the app, a kid) — they can be picked as a payer or owner
  // right away, and their first device later picks this profile at sign-in.
  function handleAddPerson() {
    const name = newName.trim();
    if (!name) return;
    store.addProfile({ id: crypto.randomUUID(), displayName: name, updatedAt: nowUtc(), deletedAt: null });
    setNewName('');
    setAdding(false);
  }

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('household.title')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      {!authAccount ? (
        <p className="empty-note">{t('household.signInFirst')}</p>
      ) : (
        <>
          {error && <p className="household-error">{error}</p>}
          {!online && <p className="household-hint">{t('household.offline')}</p>}

          <div className="section-label">{t('household.people')}</div>
          <div className="household-people">
            {active.map((p) => (
              <PersonCard
                key={p.id}
                profile={p}
                devices={devicesOf(p.id)}
                online={online}
                onRemoveDevice={(d) => void handleRemoveDevice(d)}
                onRemovePerson={() => void handleRemovePerson(p)}
              />
            ))}
            {unlinked.length > 0 && (
              <div className="household-person">
                <div className="household-person-head">
                  <span className="member-name">{t('household.unlinked')}</span>
                </div>
                {unlinked.map((d) => (
                  <DeviceRow key={d.id} device={d} online={online} onRemove={() => void handleRemoveDevice(d)} />
                ))}
              </div>
            )}
          </div>

          {adding ? (
            <div className="settings-field household-add">
              <label className="field-label">
                {t('common.name')}
                <input
                  className="text-input"
                  autoFocus
                  placeholder={t('household.namePlaceholder')}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddPerson();
                  }}
                />
              </label>
              <div className="signin-code-actions">
                <button className="save-btn" disabled={!newName.trim()} onClick={handleAddPerson}>
                  {t('common.add')}
                </button>
                <button type="button" className="chip ghost" onClick={() => setAdding(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="accounts-list">
              <button className="settings-row" onClick={() => setAdding(true)}>
                <span>{t('household.addPerson')}</span>
              </button>
              <Link to="/settings/household/link-device" className="settings-row">
                <span>{t('household.addDevice')}</span>
                <span className="settings-row-arrow">›</span>
              </Link>
            </div>
          )}
          <p className="household-hint">{t('household.addDeviceHint')}</p>

          {removed.length > 0 && (
            <>
              <div className="section-label">{t('household.removed')}</div>
              <div className="accounts-list">
                {removed.map((p) => (
                  <div className="member-row household-removed" key={p.id}>
                    <PayerBadge label={p.displayName} mine={false} className="member-badge" />
                    <span className="member-name">{p.displayName}</span>
                    <button
                      type="button"
                      className="chip ghost household-row-action"
                      onClick={() => store.updateProfile(p.id, { deletedAt: null })}
                    >
                      {t('household.restore')}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

function PersonCard({
  profile,
  devices,
  online,
  onRemoveDevice,
  onRemovePerson,
}: {
  profile: Profile;
  devices: Device[];
  online: boolean;
  onRemoveDevice: (device: Device) => void;
  onRemovePerson: () => void;
}) {
  const store = useStore();
  const { t } = useTranslation();
  // Local mirror of displayName, same reasoning as AccountsScreen's Name
  // field: binding straight to the store snaps the cursor to the end on
  // every keystroke once the async DB round-trip resolves.
  const [nameStr, setNameStr] = useState(() => profile.displayName);
  const isYou = profile.id === getLocalUserId();
  const verifiedProfileId = useVerifiedProfileId();

  return (
    <div className="household-person">
      <div className="household-person-head">
        <PayerBadge label={nameStr || profile.displayName} mine={isYou} className="member-badge" />
        <input
          className="text-input household-name-input"
          aria-label={isYou ? t('household.yourName') : t('household.theirName', { name: profile.displayName })}
          value={nameStr}
          onChange={(e) => {
            const v = e.target.value;
            setNameStr(v);
            // A blank name would leave nothing to show on payer badges —
            // held back locally until there's something real to save.
            if (v.trim()) store.updateProfile(profile.id, { displayName: v });
          }}
        />
        {isYou && <span className="member-you">{t('household.you')}</span>}
      </div>
      {devices.length === 0 ? (
        <p className="household-hint household-device-none">{t('household.noDevices')}</p>
      ) : (
        devices.map((d) => <DeviceRow key={d.id} device={d} online={online} onRemove={() => onRemoveDevice(d)} />)
      )}
      {/* docs/77 D299 — only your own PIN can be set here; everyone's
          PIN status is visible, never the PIN. */}
      {isYou ? (
        <>
          <PinResetNotice profile={profile} />
          <Link to="/settings/household/pin" className="text-link household-pin-link">
            {profile.hasPin ? t('household.changePin') : t('household.setPin')}
          </Link>
        </>
      ) : (
        profile.hasPin && (
          <p className="household-hint household-pin-note">
            {t('household.hasPin')}
            {/* D303 — reset a forgotten PIN for them from this device. */}
            {verifiedProfileId && online && (
              <>
                {' · '}
                <Link to={`/settings/household/pin?for=${profile.id}`}>{t('household.resetPin')}</Link>
              </>
            )}
          </p>
        )
      )}
      {/* You can't remove yourself here — signing out (Settings) is how a
          device leaves; another person's device can remove you. */}
      {!isYou && (
        <button type="button" className="text-link household-remove-person" disabled={!online} onClick={onRemovePerson}>
          {t('household.removePerson', { name: profile.displayName })}
        </button>
      )}
    </div>
  );
}

function DeviceRow({ device, online, onRemove }: { device: Device; online: boolean; onRemove: () => void }) {
  const { t } = useTranslation();
  const isThisDevice = device.id === getDeviceId();
  return (
    <div className="household-device">
      <span className="household-device-label">
        {device.label}
        <span className="tx-meta">{isThisDevice ? t('household.thisDevice') : t('household.seen', { time: formatTimeAgo(device.lastSeenAt) })}</span>
      </span>
      {!isThisDevice && (
        <button type="button" className="chip ghost household-row-action" disabled={!online} onClick={onRemove}>
          {t('common.remove')}
        </button>
      )}
    </div>
  );
}
