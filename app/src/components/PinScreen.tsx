import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  dismissPinResetNotice,
  ensureSessionProfile,
  requestPinResetCode,
  resetMemberPin,
  resetPinWithEmailCode,
  setProfilePin,
  useAuthAccount,
  useVerifiedProfileId,
  verifySessionProfile,
} from '../lib/auth';
import { getLocalUserId } from '../lib/identity';
import { useStore } from '../lib/store';
import { useOnline } from '../lib/syncNow';
import type { Profile } from '../lib/types';

const PIN_RE = /^\d{4,6}$/;

// docs/77 D299 — Settings → Household → PIN. Two modes:
// - set (default): set or change the PIN of the person this device is
//   verified as. Needs that verification first, since the server only
//   lets a device verified as someone change their PIN.
// - verify (?mode=verify): enter the PIN on this device, e.g. after the
//   PIN was set from another device (Home's banner links here).
// - ?for=<profile id>: set a new PIN for someone else in the household
//   who forgot theirs (D303), from this device verified as you.
export function PinScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [authAccount] = useAuthAccount();
  const verifiedProfileId = useVerifiedProfileId();
  const me = getLocalUserId();
  const profile = store.profiles.find((p) => p.id === me);
  const verified = verifiedProfileId === me;
  const forProfile = store.profiles.find((p) => p.id === params.get('for') && p.id !== me && !p.deletedAt);
  const mode = forProfile ? 'for' : params.get('mode') === 'verify' || (profile?.hasPin && !verified) ? 'verify' : 'set';

  // A person without a PIN is verified without asking; usually done
  // already after sign-in, but setting a PIN needs it.
  useEffect(() => {
    if (authAccount && !verified) void ensureSessionProfile();
  }, [authAccount, verified]);

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings/household" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('pin.title')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      {!authAccount ? (
        <p className="empty-note">{t('pin.notSignedIn')}</p>
      ) : forProfile ? (
        <ResetMemberPin profile={forProfile} />
      ) : mode === 'verify' ? (
        <div className="settings-field pin-form">
          {profile && <PinResetNotice profile={profile} />}
          <PinPrompt
            profileId={me}
            name={profile?.displayName ?? t('household.member')}
            accountUserId={authAccount.userId}
            onVerified={() => navigate(-1)}
          />
        </div>
      ) : (
        <SetPin hasPin={profile?.hasPin ?? false} />
      )}
    </main>
  );
}

function SetPin({ hasPin }: { hasPin: boolean }) {
  const store = useStore();
  const { t } = useTranslation();
  const online = useOnline();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (pin !== again) {
      setError(t('pin.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setProfilePin(pin);
      store.notePinChanged(getLocalUserId(), true);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pin.errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="settings-field pin-form">
        <p className="delete-account-text">{t('pin.saved')}</p>
        <Link to="/settings/household" className="save-btn delete-account-done">
          {t('common.done')}
        </Link>
      </div>
    );
  }

  return (
    <div className="settings-field pin-form">
      <p className="delete-account-text">{hasPin ? t('pin.changeIntro') : t('pin.setIntro')}</p>
      <label className="field-label">
        {t('pin.newPin')}
        <PinInput value={pin} onChange={setPin} autoFocus />
      </label>
      <label className="field-label">
        {t('pin.confirmPin')}
        <PinInput value={again} onChange={setAgain} />
      </label>
      <button
        className="save-btn"
        disabled={!PIN_RE.test(pin) || again.length < 4 || busy || !online}
        onClick={() => void handleSave()}
      >
        {hasPin ? t('pin.change') : t('pin.save')}
      </button>
      {!online && <p className="qr-caption">{t('pin.offline')}</p>}
      {error && <p className="household-error delete-account-error">{error}</p>}
      <p className="qr-caption">{t('pin.setForgetHint')}</p>
    </div>
  );
}

// Enter a person's PIN on this device — here and in the sign-in profile
// picker (AuthVerifyScreen). A forgotten PIN is never removed and nothing
// is erased (D302/D303): change it on another device that's already this
// person, have someone else in the household reset it from theirs, or,
// for the owner, use a code emailed to the account.
export function PinPrompt({
  profileId,
  name,
  accountUserId,
  onVerified,
}: {
  profileId: string;
  name: string;
  accountUserId: string;
  onVerified: () => void;
}) {
  const store = useStore();
  const { t } = useTranslation();
  const online = useOnline();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState<false | 'options' | 'email'>(false);
  const isOwner = profileId === accountUserId;
  const othersInHousehold = store.profiles.some((p) => p.id !== profileId && !p.deletedAt);

  async function handleVerify() {
    setBusy(true);
    setError(null);
    const result = await verifySessionProfile(profileId, pin);
    setBusy(false);
    if (result.ok) {
      onVerified();
      return;
    }
    setPin('');
    if (result.code === 'pin_invalid' && result.attemptsLeft === 0) setError(t('pin.lockedNow'));
    else if (result.code === 'pin_invalid') setError(t('pin.wrong', { count: result.attemptsLeft ?? 0 }));
    else if (result.code === 'pin_locked')
      setError(t('pin.locked', { time: result.lockedUntil ? new Date(result.lockedUntil).toLocaleTimeString([], { timeStyle: 'short' }) : '' }));
    else if (result.code === 'offline') setError(t('pin.offline'));
    else setError(result.message ?? t('pin.errorGeneric'));
  }

  async function handleSendCode() {
    setBusy(true);
    setError(null);
    try {
      await requestPinResetCode();
      setForgot('email');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pin.errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (forgot === 'email') {
    return (
      <EmailCodeReset
        onDone={() => {
          store.notePinChanged(profileId, true);
          onVerified();
        }}
        onBack={() => setForgot('options')}
        onResend={() => void handleSendCode()}
      />
    );
  }

  if (forgot === 'options') {
    return (
      <>
        <p className="delete-account-text">{t('pin.forgotOtherDevice', { name })}</p>
        {othersInHousehold && <p className="delete-account-text">{t('pin.forgotAskMember', { name })}</p>}
        {isOwner && (
          <>
            <p className="delete-account-text">{t('pin.forgotEmailIntro')}</p>
            <button className="save-btn" disabled={busy || !online} onClick={() => void handleSendCode()}>
              {t('pin.forgotEmailSend')}
            </button>
          </>
        )}
        <button type="button" className="chip ghost" onClick={() => setForgot(false)}>
          {t('common.cancel')}
        </button>
        {!online && <p className="qr-caption">{t('pin.offline')}</p>}
        {error && <p className="household-error delete-account-error">{error}</p>}
      </>
    );
  }

  return (
    <>
      <p className="delete-account-text">{t('pin.enterIntro', { name })}</p>
      <label className="field-label">
        {t('pin.pinLabel')}
        <PinInput
          value={pin}
          onChange={setPin}
          autoFocus
          onEnter={() => {
            if (PIN_RE.test(pin) && !busy) void handleVerify();
          }}
        />
      </label>
      <button className="save-btn" disabled={!PIN_RE.test(pin) || busy || !online} onClick={() => void handleVerify()}>
        {t('pin.continue')}
      </button>
      {!online && <p className="qr-caption">{t('pin.offline')}</p>}
      {error && <p className="household-error delete-account-error">{error}</p>}
      <p className="qr-caption">{t('pin.otherDeviceHint', { name })}</p>
      <button type="button" className="text-link pin-link" onClick={() => setForgot('options')}>
        {t('pin.forgot')}
      </button>
    </>
  );
}

// D302 — the owner types the emailed code and picks a new PIN.
function EmailCodeReset({ onDone, onBack, onResend }: { onDone: () => void; onBack: () => void; onResend: () => void }) {
  const { t } = useTranslation();
  const online = useOnline();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    if (pin !== again) {
      setError(t('pin.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPinWithEmailCode(code, pin);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pin.errorGeneric'));
      setBusy(false);
    }
  }

  return (
    <>
      <p className="delete-account-text">{t('pin.emailSent')}</p>
      <label className="field-label">
        {t('pin.emailCode')}
        <input
          className="text-input pin-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7))}
        />
      </label>
      <label className="field-label">
        {t('pin.newPin')}
        <PinInput value={pin} onChange={setPin} />
      </label>
      <label className="field-label">
        {t('pin.confirmPin')}
        <PinInput value={again} onChange={setAgain} />
      </label>
      <button
        className="save-btn"
        disabled={code.replace(/\s/g, '').length !== 6 || !PIN_RE.test(pin) || again.length < 4 || busy || !online}
        onClick={() => void handleReset()}
      >
        {t('pin.save')}
      </button>
      {!online && <p className="qr-caption">{t('pin.offline')}</p>}
      {error && <p className="household-error delete-account-error">{error}</p>}
      <button type="button" className="text-link pin-link" disabled={busy || !online} onClick={onResend}>
        {t('pin.emailResend')}
      </button>
      <button type="button" className="chip ghost" onClick={onBack}>
        {t('common.cancel')}
      </button>
    </>
  );
}

// D303 — set a new PIN for someone else in the household, from this
// device. Needs this device verified as you (the server records who did
// it); it stays you, so it never gets their Only me records.
function ResetMemberPin({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const online = useOnline();
  const verifiedProfileId = useVerifiedProfileId();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const name = profile.displayName;

  async function handleReset() {
    if (pin !== again) {
      setError(t('pin.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetMemberPin(profile.id, pin);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pin.errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="settings-field pin-form">
        <p className="delete-account-text">{t('pin.resetForDone', { name })}</p>
        <Link to="/settings/household" className="save-btn delete-account-done">
          {t('common.done')}
        </Link>
      </div>
    );
  }

  if (!verifiedProfileId) {
    return <p className="empty-note">{t('pin.errorNotVerified')}</p>;
  }

  return (
    <div className="settings-field pin-form">
      <p className="delete-account-text">{t('pin.resetForIntro', { name })}</p>
      <label className="field-label">
        {t('pin.newPin')}
        <PinInput value={pin} onChange={setPin} autoFocus />
      </label>
      <label className="field-label">
        {t('pin.confirmPin')}
        <PinInput value={again} onChange={setAgain} />
      </label>
      <button
        className="save-btn"
        disabled={!PIN_RE.test(pin) || again.length < 4 || busy || !online}
        onClick={() => void handleReset()}
      >
        {t('pin.resetForButton', { name })}
      </button>
      {!online && <p className="qr-caption">{t('pin.offline')}</p>}
      {error && <p className="household-error delete-account-error">{error}</p>}
    </div>
  );
}

// D304 — "Your PIN was reset by …": the text for a person's last reset
// notice, or null. Shown on Home (SessionExpiredBanner), on their
// Household card and above the PIN prompt.
export function usePinResetNoticeText(profile: Profile | undefined): string | null {
  const store = useStore();
  const { t } = useTranslation();
  const reset = profile?.pinReset;
  if (!profile || !reset) return null;
  const when = new Date(reset.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const device = reset.deviceLabel ?? t('pin.unknownDevice');
  if (!reset.byProfileId || reset.byProfileId === profile.id) return t('pin.resetNoticeEmail', { device, when });
  const by = store.profiles.find((p) => p.id === reset.byProfileId)?.displayName ?? t('household.member');
  return t('pin.resetNoticeBy', { name: by, device, when });
}

// The notice with its "Got it", which needs this device verified as that
// person (the server clears it for all their devices).
export function PinResetNotice({ profile }: { profile: Profile }) {
  const store = useStore();
  const { t } = useTranslation();
  const online = useOnline();
  const verifiedProfileId = useVerifiedProfileId();
  const text = usePinResetNoticeText(profile);
  const [error, setError] = useState<string | null>(null);
  if (!text) return null;

  async function handleDismiss() {
    setError(null);
    try {
      await dismissPinResetNotice();
      store.notePinResetSeen(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pin.errorGeneric'));
    }
  }

  return (
    <div className="pin-reset-notice">
      <p>{text}</p>
      {verifiedProfileId === profile.id && (
        <button type="button" className="chip ghost" disabled={!online} onClick={() => void handleDismiss()}>
          {t('pin.resetNoticeDismiss')}
        </button>
      )}
      {error && <p className="household-error">{error}</p>}
    </div>
  );
}

function PinInput({
  value,
  onChange,
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      className="text-input pin-input"
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={6}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter?.();
      }}
    />
  );
}
