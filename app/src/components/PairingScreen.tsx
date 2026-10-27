import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { answerOffer, completeOffer, exchangeHello, exchangeJson, startOffer, wrapChannel } from '../lib/pairing';
import type { AnswerSession, OfferSession, PairedChannel } from '../lib/pairing';
import { computeSas, joinRelayAsAnswerer, startRelayOffer } from '../lib/relayClient';
import { getLocalUserId } from '../lib/identity';
import { isUntouchedSeedAccount, referencedAccountIds } from '../lib/seed';
import { usePairedPeers } from '../lib/peers';
import { effectiveDeviceLabel } from '../lib/settings';
import { useStore } from '../lib/store';
import type { MergeSummary, PeerDataset, Transaction, TransactionSplit } from '../lib/types';
import { QrCanvas, QrScanStep } from './Qr';

// docs/27's sketch (frames 2-5), implemented for real, now with docs/24's
// actual merge wired in (previously stubbed — see docs/00-backlog). One
// deliberate deviation from the sketch, flagged when this was first
// built: the sketch drew "show your code" and "scan + confirm" as two
// different devices' single screens. A real handshake needs *both*
// devices to both show and scan — whoever goes first shows-then-scans,
// the other scans-then-shows-back — so this adds a "who goes first"
// choice the sketch simplified away.

type IdentityChoice = 'own-device' | 'someone-else';
type Role = 'show-first' | 'scan-first';
// docs/28: "are you together right now?" — orthogonal to identity/role.
// Together keeps the existing QR path (physical proximity is the trust
// anchor). Remote uses the relay (docs/28) and needs its own trust
// mechanism in place of proximity — the SAS confirmation step below.
type Reach = 'together' | 'remote';

type Step =
  | { kind: 'choice' }
  | { kind: 'reach' }
  | { kind: 'role' }
  | { kind: 'show-offer'; session: OfferSession }
  | { kind: 'scan-for-answer'; session: OfferSession }
  | { kind: 'scan-for-offer' }
  | { kind: 'show-answer'; session: AnswerSession }
  | { kind: 'relay-show-code'; code: string }
  | { kind: 'relay-enter-code' }
  | { kind: 'relay-connecting' }
  | {
      kind: 'sas-confirm';
      emoji: string[];
      peerConnection: RTCPeerConnection;
      pairedChannel: PairedChannel;
      role: 'offerer' | 'answerer';
    }
  | {
      kind: 'merge-prompt';
      pc: PairedChannel;
      peerLabel: string;
      peerLocalUserId: string;
      existingAccounts: number;
      existingTransactions: number;
    }
  | { kind: 'merging' }
  | { kind: 'synced'; peerLabel: string; summary: MergeSummary }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export function PairingScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const store = useStore();
  const [searchParams] = useSearchParams();
  const [peers, recordSync] = usePairedPeers();

  // docs/00-backlog, 2026-08-14: "once they pair, they'll probably do it
  // again" — a repeat sync with an already-known peer (tapped from
  // Settings' peer list, /settings/pair?peer=<id>) skips the own-device/
  // someone-else question entirely, since it's remembered from last time
  // rather than re-asked. A fresh "Connect a device" tap has no matching
  // peer and goes through the full choice flow as before.
  const knownPeer = peers.find((p) => p.id === searchParams.get('peer'));
  const startedFromKnownPeer = knownPeer !== undefined;

  const [identity, setIdentity] = useState<IdentityChoice | null>(knownPeer?.identityMode ?? null);
  const [reach, setReach] = useState<Reach | null>(null);
  // A known peer still gets asked "together or remote?" — that's a fresh
  // per-session fact even for someone you've paired with before — just
  // not the identity question, which genuinely doesn't change.
  const [step, setStep] = useState<Step>(knownPeer ? { kind: 'reach' } : { kind: 'choice' });

  function chooseIdentity(choice: IdentityChoice) {
    setIdentity(choice);
    setStep({ kind: 'reach' });
  }

  function chooseReach(choice: Reach) {
    setReach(choice);
    setStep({ kind: 'role' });
  }

  async function chooseRole(role: Role) {
    if (reach === 'remote') {
      if (role === 'show-first') {
        await startRelayFlow();
      } else {
        setStep({ kind: 'relay-enter-code' });
      }
      return;
    }
    if (role === 'show-first') {
      try {
        const session = await startOffer();
        setStep({ kind: 'show-offer', session });
      } catch {
        setStep({ kind: 'error', message: t('pairing.startFailed') });
      }
    } else {
      setStep({ kind: 'scan-for-offer' });
    }
  }

  // docs/28: the initiator's half — generate a code, show it immediately
  // (relayOfferResult splits this out specifically so the code doesn't
  // wait on the full handshake, which depends on a human reading and
  // typing it on another device), then wait in the background for the
  // answer to arrive over the relay before computing the SAS. Wraps the
  // channel the instant it opens, not later — see afterHandshake's own
  // comment for why that ordering specifically matters here.
  async function startRelayFlow() {
    try {
      const { code, session, connected } = await startRelayOffer();
      setStep({ kind: 'relay-show-code', code });
      await connected;
      const channel = await session.channelPromise;
      const pairedChannel = wrapChannel(channel);
      const emoji = await computeSas(session.pc);
      setStep({ kind: 'sas-confirm', emoji, peerConnection: session.pc, pairedChannel, role: 'offerer' });
    } catch (err) {
      setStep({ kind: 'error', message: err instanceof Error ? err.message : t('pairing.connectFailed') });
    }
  }

  // The joiner's half — enter the code, connect, compute the same SAS
  // independently (docs/28 D143: identical inputs on both sides produce
  // an identical result with no further exchange needed).
  async function submitRelayCode(code: string) {
    setStep({ kind: 'relay-connecting' });
    try {
      const session = await joinRelayAsAnswerer(code);
      const channel = await session.channelPromise;
      const pairedChannel = wrapChannel(channel);
      const emoji = await computeSas(session.pc);
      setStep({ kind: 'sas-confirm', emoji, peerConnection: session.pc, pairedChannel, role: 'answerer' });
    } catch (err) {
      setStep({
        kind: 'error',
        message: err instanceof Error ? err.message : t('pairing.connectCodeFailed'),
      });
    }
  }

  // Runs the actual docs/24 merge: exchange full local datasets over the
  // now-open channel, apply the peer's data with store.applyPeerDataset,
  // land on a real "synced" summary instead of the placeholder copy this
  // screen originally shipped with.
  async function performMerge(pc: PairedChannel, peerLabel: string, peerLocalUserId: string, adoptPeerIdentity: boolean) {
    setStep({ kind: 'merging' });
    try {
      // The joining device in own-device mode never sends its untouched
      // starter accounts — applyPeerDataset discards them on this side
      // anyway, and sending them would plant duplicate Cash/Checking on
      // the canonical device.
      const referenced = referencedAccountIds([...store.transactions, ...store.scheduledPayments], store.transactionSplits);
      const accounts = adoptPeerIdentity
        ? store.accounts.filter((a) => !isUntouchedSeedAccount(a, referenced))
        : store.accounts;
      // docs/77 D301 — "Only me" records go only to my own devices. Both
      // directions are filtered, so an older or misbehaving peer that does
      // send someone's private rows still doesn't get them stored here.
      const ownDevice = identity === 'own-device';
      const localDataset: PeerDataset = {
        localUserId: getLocalUserId(),
        categories: store.categories,
        accounts,
        ...withoutPrivate(store.transactions, store.transactionSplits, ownDevice),
        scheduledPayments: store.scheduledPayments,
        budgets: store.budgets,
      };
      const received = await exchangeJson<PeerDataset>(pc, localDataset);
      const peerDataset: PeerDataset = {
        ...received,
        ...withoutPrivate(received.transactions, received.transactionSplits, ownDevice),
      };
      const summary = await store.applyPeerDataset(peerDataset, adoptPeerIdentity);
      // Upserts by peerLocalUserId (peers.ts) — a repeat sync with this
      // same peer updates their row instead of adding a duplicate, and
      // is what makes the next visit to Settings offer the lighter
      // known-peer flow above instead of the full choice screen again.
      recordSync(peerLocalUserId, peerLabel, identity ?? 'someone-else');
      setStep({ kind: 'synced', peerLabel, summary });
    } catch {
      setStep({ kind: 'error', message: t('pairing.dropped') });
    }
  }

  // Shared by both roles once their data channel is open — docs/25 D125:
  // only the *joining* device in "my own device" mode (the one that
  // scanned someone else's already-showing code) ever unifies identity;
  // the device that showed its code first stays canonical. "someone
  // else" mode never unifies identity at all, regardless of role.
  //
  // wrapChannel() runs exactly once here, before anything is sent — the
  // real bug this fixed (found on real hardware): the joining device
  // pauses at D126's merge-prompt for a user tap, but the other device
  // doesn't know to wait and proceeds straight into the data exchange.
  // A fresh `channel.addEventListener` per exchange call could miss a
  // message that arrived during that pause; wrapChannel's persistent
  // queue can't, no matter how long the pause is.
  //
  // Takes an already-wrapped PairedChannel, not a raw RTCDataChannel — a
  // real bug, found while adding the relay/SAS flow: wrapping late (i.e.
  // only once this function actually runs) is fine when nothing sits
  // between "channel opens" and "this function is called" (the QR path's
  // exact shape), but the SAS confirmation step deliberately inserts a
  // human-paced gap there. If the peer's hello arrived during that gap,
  // before *this* side had wrapped the channel at all, it had zero
  // listeners to catch it — completely dropped, the same root cause as
  // D135, just triggered by a different kind of gap. Every call site now
  // wraps the channel the instant it opens, not whenever this function
  // happens to run.
  async function afterHandshake(pc: PairedChannel, role: 'offerer' | 'answerer') {
    try {
      const { peerLabel, peerLocalUserId } = await exchangeHello(pc, effectiveDeviceLabel(), getLocalUserId());

      // Already the same identity (e.g. re-pairing after an earlier
      // own-device merge already unified them) — nothing to ask about or
      // rewrite, skip straight to a plain merge.
      const isJoiningDeviceInOwnDeviceMode =
        identity === 'own-device' && role === 'answerer' && peerLocalUserId !== getLocalUserId();
      if (isJoiningDeviceInOwnDeviceMode) {
        // docs/25 D126: ask before rewriting this device's existing data
        // — but only if there's anything to ask about. Skips straight to
        // the merge for a genuinely fresh device, matching D126's "a
        // fresh device with no prior data skips this sheet entirely."
        // Untouched starter accounts (seed.ts) don't count — a fresh
        // install still has nothing worth asking about.
        const referenced = referencedAccountIds([...store.transactions, ...store.scheduledPayments], store.transactionSplits);
        const existingAccounts = store.accounts.filter((a) => !isUntouchedSeedAccount(a, referenced)).length;
        const existingTransactions = store.transactions.length;
        if (existingAccounts > 0 || existingTransactions > 0) {
          setStep({ kind: 'merge-prompt', pc, peerLabel, peerLocalUserId, existingAccounts, existingTransactions });
          return;
        }
        await performMerge(pc, peerLabel, peerLocalUserId, true);
        return;
      }

      await performMerge(pc, peerLabel, peerLocalUserId, false);
    } catch {
      setStep({ kind: 'error', message: t('pairing.dropped') });
    }
  }

  async function handleScannedOffer(offerPayload: string) {
    try {
      const session = await answerOffer(offerPayload);
      setStep({ kind: 'show-answer', session });
      const channel = await session.channelPromise;
      await afterHandshake(wrapChannel(channel), 'answerer');
    } catch {
      setStep({ kind: 'error', message: t('pairing.incomplete') });
    }
  }

  async function handleScannedAnswer(session: OfferSession, answerPayload: string) {
    try {
      await completeOffer(session, answerPayload);
      const channel = await session.channelPromise;
      await afterHandshake(wrapChannel(channel), 'offerer');
    } catch {
      setStep({ kind: 'error', message: t('pairing.dropped') });
    }
  }

  return (
    <main className="home">
      <div className="app-bar">
        {step.kind === 'choice' || startedFromKnownPeer ? (
          // A known-peer session skipped 'choice' entirely (it starts at
          // 'reach'), so there's no earlier in-flow step for Cancel to
          // fall back to — it exits straight to Settings instead, same
          // as the top-level Cancel already does for a fresh session.
          <Link to="/settings" className="back-link">
            ← {t('pairing.cancel')}
          </Link>
        ) : (
          <button className="back-link" onClick={() => setStep({ kind: 'choice' })}>
            ← {t('pairing.cancel')}
          </button>
        )}
      </div>

      {step.kind === 'choice' && (
        <>
          <div className="section-label">{t('pairing.whoQuestion')}</div>
          <div className="choice-stack">
            <button className="choice-card" onClick={() => chooseIdentity('own-device')}>
              <span className="choice-title">{t('pairing.ownDevice')}</span>
              <span className="choice-sub">{t('pairing.ownDeviceSub')}</span>
            </button>
            <button className="choice-card" onClick={() => chooseIdentity('someone-else')}>
              <span className="choice-title">{t('pairing.someoneElse')}</span>
              <span className="choice-sub">{t('pairing.someoneElseSub')}</span>
            </button>
          </div>
        </>
      )}

      {step.kind === 'reach' && (
        <>
          <div className="section-label">{t('pairing.togetherQuestion')}</div>
          <div className="choice-stack">
            <button className="choice-card" onClick={() => chooseReach('together')}>
              <span className="choice-title">{t('pairing.together')}</span>
              <span className="choice-sub">{t('pairing.togetherSub')}</span>
            </button>
            <button className="choice-card" onClick={() => chooseReach('remote')}>
              <span className="choice-title">{t('pairing.remote')}</span>
              <span className="choice-sub">{t('pairing.remoteSub')}</span>
            </button>
          </div>
        </>
      )}

      {step.kind === 'role' && (
        <>
          <div className="section-label">{knownPeer ? t('pairing.syncWith', { name: knownPeer.label }) : t('pairing.whichDevice')}</div>
          <div className="choice-stack">
            <button className="choice-card" onClick={() => chooseRole('show-first')}>
              <span className="choice-title">{reach === 'remote' ? t('pairing.generateCode') : t('pairing.showFirst')}</span>
              <span className="choice-sub">
                {reach === 'remote' ? t('pairing.otherEnters') : t('pairing.otherScans')}
              </span>
            </button>
            <button className="choice-card" onClick={() => chooseRole('scan-first')}>
              <span className="choice-title">{reach === 'remote' ? t('pairing.haveCode') : t('pairing.scanFirst')}</span>
              <span className="choice-sub">
                {reach === 'remote' ? t('pairing.alreadySent') : t('pairing.otherShowing')}
              </span>
            </button>
          </div>
        </>
      )}

      {step.kind === 'show-offer' && (
        <QrShowStep
          payload={step.session.offerPayload}
          caption={t('pairing.haveOtherScan')}
          onNext={() => setStep({ kind: 'scan-for-answer', session: step.session })}
          nextLabel={t('pairing.shownNext')}
        />
      )}

      {step.kind === 'scan-for-answer' && (
        <QrScanStep
          caption={t('pairing.scanTheirs')}
          onResult={(text) => void handleScannedAnswer(step.session, text)}
        />
      )}

      {step.kind === 'scan-for-offer' && (
        <QrScanStep caption={t('pairing.pointAtCode')} onResult={(text) => void handleScannedOffer(text)} />
      )}

      {step.kind === 'show-answer' && (
        <QrShowStep payload={step.session.answerPayload} caption={t('pairing.showBack')} />
      )}

      {step.kind === 'relay-show-code' && (
        <div className="qr-stage">
          <div className="qr-caption relay-code">{step.code}</div>
          <p className="qr-caption">{t('pairing.readCode')}</p>
          {/* Same QrCanvas as the QR pairing flow, just encoding the short
              code instead of an SDP payload — if the other person happens
              to be nearby, scanning sidesteps typos entirely (0/O, 1/I/l),
              without giving up the "works over a phone call" case, which
              still has the plain text above. */}
          <QrCanvas payload={step.code} />
          <div className="qr-caption">
            <span className="pulse-dot" /> {t('pairing.waitingEntry')}
          </div>
        </div>
      )}

      {step.kind === 'relay-enter-code' && <RelayCodeEntry onSubmit={(code) => void submitRelayCode(code)} />}

      {step.kind === 'relay-connecting' && (
        <div className="qr-stage">
          <p className="qr-caption">{t('pairing.connecting')}</p>
        </div>
      )}

      {step.kind === 'sas-confirm' && (
        <div className="qr-stage">
          <p className="qr-caption">{t('pairing.sasPrompt')}</p>
          <div className="sas-emoji">{step.emoji.join(' ')}</div>
          <button className="save-btn" onClick={() => void afterHandshake(step.pairedChannel, step.role)}>
            {t('pairing.sasMatch')}
          </button>
          <button
            className="text-link"
            onClick={() => {
              step.peerConnection.close();
              setStep({ kind: 'error', message: t('pairing.sasMismatch') });
            }}
          >
            {t('pairing.sasNoMatch')}
          </button>
        </div>
      )}

      {step.kind === 'merge-prompt' && (
        <div className="qr-stage">
          <p className="qr-caption">
            {t('pairing.mergePrompt', {
              accounts: t('pairing.accounts', { count: step.existingAccounts }),
              transactions: t('transactions.count', { count: step.existingTransactions }),
            })}
          </p>
          <button
            className="save-btn"
            onClick={() => void performMerge(step.pc, step.peerLabel, step.peerLocalUserId, true)}
          >
            {t('pairing.merge')}
          </button>
          <button className="text-link" onClick={() => setStep({ kind: 'cancelled' })}>
            {t('pairing.keepSeparate')}
          </button>
        </div>
      )}

      {step.kind === 'merging' && (
        <div className="qr-stage">
          <p className="qr-caption">{t('pairing.syncing')}</p>
        </div>
      )}

      {step.kind === 'synced' && (
        <div className="qr-stage">
          <div className="confirm-check">✓</div>
          <p className="qr-caption">
            <Trans
              i18nKey="pairing.done"
              values={{
                peer: step.peerLabel,
                categories: step.summary.categoriesAdded,
                accounts: step.summary.accountsAdded,
                transactions: step.summary.transactionsAdded,
                budgets: step.summary.budgetsAdded,
                updated: step.summary.budgetsUpdated > 0 ? t('pairing.budgetsUpdated', { count: step.summary.budgetsUpdated }) : '',
              }}
              components={{ b: <b /> }}
            />
          </p>
          <button className="save-btn" onClick={() => navigate('/settings')}>
            {t('common.done')}
          </button>
        </div>
      )}

      {step.kind === 'cancelled' && (
        <div className="qr-stage">
          <p className="qr-caption">{t('pairing.cancelled')}</p>
          <button className="save-btn" onClick={() => navigate('/settings')}>
            {t('common.done')}
          </button>
        </div>
      )}

      {step.kind === 'error' && (
        <div className="qr-stage">
          <p className="qr-caption">{step.message}</p>
          <button className="save-btn" onClick={() => setStep({ kind: 'choice' })}>
            {t('common.tryAgain')}
          </button>
        </div>
      )}
    </main>
  );
}

// Strips anything that isn't part of the code alphabet, uppercases, and
// re-inserts the dash at position 4 — same normalization whether the
// text came from typing or a QR scan, so both paths land on an identical
// value and the relay (not this function) is the real arbiter of
// whether a code is actually valid.
function normalizeRelayCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
}

function RelayCodeEntry({ onSubmit }: { onSubmit: (code: string) => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  // Typing is the only option that works over a phone call with someone
  // genuinely remote; scanning is the faster, typo-proof option (no
  // 0/O or 1/I/l confusion) when the other device happens to be in
  // reach. Reuses QrScanStep exactly as-is — the camera-lifecycle and
  // repeat-decode fixes it already has apply here for free.
  const [mode, setMode] = useState<'type' | 'scan'>('type');

  if (mode === 'scan') {
    return (
      <>
        <QrScanStep
          caption={t('pairing.scanOther')}
          onResult={(text) => onSubmit(normalizeRelayCode(text))}
        />
        <button className="text-link relay-mode-toggle" onClick={() => setMode('type')}>
          {t('pairing.typeInstead')}
        </button>
      </>
    );
  }

  return (
    <div className="qr-stage">
      <p className="qr-caption">{t('pairing.enterCode')}</p>
      <input
        className="text-input relay-code-input"
        value={code}
        onChange={(e) => setCode(normalizeRelayCode(e.target.value))}
        placeholder="XXXX-XXXX"
        maxLength={9}
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
      />
      <button className="save-btn" onClick={() => onSubmit(code.trim())} disabled={!code.trim()}>
        {t('pairing.connect')}
      </button>
      <button className="text-link" onClick={() => setMode('scan')}>
        {t('pairing.scanInstead')}
      </button>
    </div>
  );
}

function QrShowStep({
  payload,
  caption,
  onNext,
  nextLabel,
}: {
  payload: string;
  caption: string;
  onNext?: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="qr-stage">
      <QrCanvas payload={payload} />
      <p className="qr-caption">{caption}</p>
      {onNext && (
        <button className="save-btn" onClick={onNext}>
          {nextLabel}
        </button>
      )}
    </div>
  );
}


// docs/77 D301 — drops "Only me" rows (and their split legs) from a dataset
// crossing between two people's devices. Kept when syncing with my own
// other device.
function withoutPrivate(
  transactions: Transaction[],
  transactionSplits: TransactionSplit[],
  ownDevice: boolean,
): { transactions: Transaction[]; transactionSplits: TransactionSplit[] } {
  if (ownDevice) return { transactions, transactionSplits };
  const hidden = new Set(transactions.filter((t) => t.privateToProfileId).map((t) => t.id));
  return {
    transactions: transactions.filter((t) => !hidden.has(t.id)),
    transactionSplits: transactionSplits.filter((s) => !hidden.has(s.transactionId)),
  };
}
